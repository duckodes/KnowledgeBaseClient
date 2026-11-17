import { createDocumentApi, DocumentError } from "./document-api.js";
export const CACHE_TTL = 5 * 60_000;
export const CACHE_LIMITS = Object.freeze({ entries: 20, bytes: 4 * 1024 * 1024 });
const excludedNames = new Set([
	"agents.md", "analysis-reprt", "analysis-reprt.md", "analysis-report", "analysis-report.md", "analysis-report-ai",
	"00_ai檢索地圖與回答規則", "00_ai檢索地圖與回答規則.md",
]);

export class DocumentSource {
	constructor({ api = createDocumentApi(), now = Date.now, ttl = CACHE_TTL, limits = CACHE_LIMITS } = {}) {
		this.api = api;
		this.now = now;
		this.ttl = ttl;
		this.limits = limits;
		this.user = null;
		this.reset();
	}
	reset(reason = "session-reset") {
		clearTimeout(this.expiryTimer);
		this.controller?.abort(reason);
		this.controller = new AbortController();
		this.generation = (this.generation || 0) + 1;
		this.documents = new Map();
		this.cache = new Map();
		this.flights = new Map();
		this.cacheBytes = 0;
		this.cachePolicy = "unknown";
		this.metrics = {};
	}
	setUser(user) {
		this.reset(user ? "user-switch" : "sign-out");
		this.user = user;
	}
	async run(operation, path, { signal = this.controller.signal, onState } = {}) {
		if (!this.user) throw new DocumentError("login-required");
		signal = AbortSignal.any([signal, this.controller.signal]);
		const generation = this.generation;
		try {
			const result = operation === "listDocuments"
				? await this.api.listDocuments(this.user, signal, { onState })
				: await this.api.loadDocument(this.user, path, signal, { onState });
			if (generation !== this.generation || signal.aborted) throw new DocumentError("abort");
			this.cachePolicy = result.cachePolicy;
			if (result.cachePolicy === "unsafe") throw new DocumentError("cache");
			this.metrics[operation === "listDocuments" ? "metadata" : "document"] = result.metrics;
			return result;
		} catch (error) {
			if (generation !== this.generation || signal.aborted) throw new DocumentError("abort");
			this.metrics[operation === "listDocuments" ? "metadata" : "document"] = error.metrics;
			if (["unauthorized", "forbidden"].includes(error.code)) this.reset("permission-failure");
			throw error;
		}
	}
	async listDocuments(options = {}) {
		const previous = this.cache;
		this.reset("metadata-refresh");
		const generation = this.generation;
		const { files } = await this.run("listDocuments", null, options);
		if (generation !== this.generation) throw new DocumentError("abort");
		this.documents = new Map(files
			.filter(({ path }) => !path.split("/").some((name) => excludedNames.has(name.normalize("NFC").toLowerCase())))
			.map((file) => [file.path, file]));
		for (const [path, entry] of previous) {
			const metadata = this.documents.get(path);
			if (entry.expires > this.now() && metadata?.updated === entry.updated && metadata.bytes === entry.bytes) this.store(path, entry);
		}
		return this.documents;
	}
	remove(path) {
		const entry = this.cache.get(path);
		if (entry) this.cacheBytes -= entry.memoryBytes;
		this.cache.delete(path);
	}
	store(path, entry) {
		this.remove(path);
		if (entry.memoryBytes > this.limits.bytes) return;
		this.cache.set(path, entry);
		this.cacheBytes += entry.memoryBytes;
		while (this.cache.size > this.limits.entries || this.cacheBytes > this.limits.bytes) this.remove(this.cache.keys().next().value);
		this.scheduleExpiry();
	}
	scheduleExpiry() {
		clearTimeout(this.expiryTimer);
		if (this.cache.size) {
			this.expiryTimer = setTimeout(() => {
				for (const [key, entry] of this.cache) if (entry.expires <= this.now()) this.remove(key);
				this.scheduleExpiry();
			}, Math.max(0, Math.min(...[...this.cache.values()].map((entry) => entry.expires)) - this.now()));
			this.expiryTimer.unref?.();
		}
	}
	async loadDocument(path, { signal, onState, reload = false } = {}) {
		const started = performance.now();
		if (!this.user) throw new DocumentError("login-required");
		if (signal?.aborted) throw new DocumentError("abort");
		if (!this.documents.has(path)) throw new DocumentError("missing");
		for (const [key, entry] of this.cache) if (entry.expires <= this.now()) this.remove(key);
		if (reload) this.remove(path);
		const cached = this.cache.get(path);
		if (cached) {
			this.store(path, cached);
			this.metrics.document = { cacheHit: true, cacheMs: performance.now() - started, requestMs: 0, bytes: 0, retries: 0 };
			return cached;
		}
		let flight = this.flights.get(path);
		if (!flight) {
			const generation = this.generation;
			const controller = new AbortController();
			const sharedSignal = AbortSignal.any([this.controller.signal, controller.signal]);
			flight = { controller, waiters: new Set() };
			this.flights.set(path, flight);
			const metadata = this.documents.get(path);
			flight.promise = this.run("loadDocument", path, {
				signal: sharedSignal,
				onState: (state) => {
					if (generation === this.generation && !sharedSignal.aborted) for (const waiter of flight.waiters) waiter.onState?.(state);
				},
			}).then(({ document: file }) => {
				if (generation !== this.generation || sharedSignal.aborted || this.documents.get(path) !== metadata) throw new DocumentError("abort");
				if (!file || file.path !== path) throw new DocumentError("schema");
				const fetchedAt = this.now();
				const entry = { ...file, title: path.split("/").at(-1).replace(/\.md$/i, ""), text: file.content, fetchedAt, expires: fetchedAt + this.ttl, memoryBytes: file.content.length * 2 + path.length * 2 + 256 };
				this.store(path, entry);
				return entry;
			});
			void flight.promise.finally(() => { if (this.flights.get(path) === flight) this.flights.delete(path); }).catch(() => {});
		}
		// A route owns its subscription; only the final departing waiter cancels shared work.
		return new Promise((resolve, reject) => {
			const waiter = { onState };
			flight.waiters.add(waiter);
			const release = () => {
				signal?.removeEventListener("abort", abort);
				flight.waiters.delete(waiter);
				if (!flight.waiters.size && this.flights.get(path) === flight) {
					this.flights.delete(path);
					flight.controller.abort(signal?.reason || "no-waiters");
				}
			};
			const abort = () => { release(); reject(new DocumentError("abort", { abortReason: signal?.reason === "user-abort" ? "user-abort" : "route-change" })); };
			signal?.addEventListener("abort", abort, { once: true });
			flight.promise.then((file) => { release(); resolve(file); }, (error) => { release(); reject(error); });
			if (signal?.aborted) abort();
		});
	}
}
