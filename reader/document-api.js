export const DOCUMENT_ENDPOINT = "https://us-central1-source-c3817.cloudfunctions.net/getKnowledgeBaseFiles";
export const SINGLE_DOCUMENT_ENDPOINT = "https://us-central1-source-c3817.cloudfunctions.net/getKnowledgeBaseFile";
export const LIMITS = Object.freeze({ files: 1000, fileBytes: 600_000, contentChars: 150_000, payloadBytes: 32 * 1024 * 1024, singlePayloadBytes: 1024 * 1024 });
export class DocumentError extends Error {
	constructor(code, details = {}) { super(code); this.code = code; Object.assign(this, details); }
}
function abortError(signal) {
	const abortReason = signal.reason?.name === "TimeoutError" ? "deadline" : ["user-abort", "route-change", "sign-out", "user-switch", "metadata-refresh", "permission-failure"].includes(signal.reason) ? signal.reason : "caller-abort";
	return new DocumentError(abortReason === "deadline" ? "timeout" : "abort", { abortReason });
}
export function parseRetryAfter(value, now = Date.now()) {
	if (typeof value !== "string" || !value.trim()) return null;
	const text = value.trim();
	const ms = /^\d+$/.test(text) ? Number(text) * 1000 : /^[A-Za-z]{3}, /.test(text) ? Date.parse(text) - now : NaN;
	return Number.isFinite(ms) && ms >= 0 && ms <= Number.MAX_SAFE_INTEGER ? ms : null;
}
export function retryDelay(error, attempt, random = Math.random) {
	if (!(error.code === "network" || error.code === "timeout" || [429, 502, 503, 504].includes(error.status))) return null;
	return Math.max(error.retryAfterMs || 0, 500 * 2 ** attempt * (0.5 + random() * 0.5));
}
export function waitForRetry(ms, signal) {
	return new Promise((resolve, reject) => {
		const abort = () => { clearTimeout(timer); reject(abortError(signal)); };
		const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
}
export function validDocumentPath(path) {
	if (typeof path !== "string" || !path || path.length > 2048 || !/\.md$/i.test(path) || /[\\%:?#\u0000-\u001f\u007f]/u.test(path)) return false;
	try { encodeURIComponent(path); } catch { return false; }
	return path.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}
export function validateFiles(payload, full = false) {
	if (!payload || !Array.isArray(payload.files)) throw new DocumentError("schema");
	if (payload.files.length > LIMITS.files) throw new DocumentError("limit");
	const paths = new Set(); let total = 0;
	return payload.files.map((file) => {
		if (!file || !validDocumentPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.updated !== "string" || !/^\d{4}-\d\d-\d\dT/.test(file.updated) || !Number.isFinite(Date.parse(file.updated)) || paths.has(file.path) || (full && typeof file.content !== "string")) throw new DocumentError("schema");
		paths.add(file.path); total += file.bytes;
		if (file.bytes > LIMITS.fileBytes || total > LIMITS.payloadBytes || (full && (file.content.length > LIMITS.contentChars || new TextEncoder().encode(file.content).length > LIMITS.fileBytes))) throw new DocumentError("limit");
		return { path: file.path, bytes: file.bytes, updated: file.updated, ...(full ? { content: file.content } : {}) };
	});
}
export function validateSingleDocument(payload, path) {
	if (!payload || !payload.file || Array.isArray(payload.file) || payload.file.path !== path) throw new DocumentError("schema");
	return validateFiles({ files: [payload.file] }, true)[0];
}

export function createDocumentApi({ fetchImpl = fetch, timeoutMs = 10_000, deadlineMs = 30_000, maxRetries = 2, random = Math.random, sleep = waitForRetry } = {}) {
	async function request(user, url, mode, signal, { onState } = {}) {
		if (!user) throw new DocumentError("login-required");
		const started = performance.now();
		const operationSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(deadlineMs)]);
		const metrics = { tokenMs: 0, headersMs: 0, bodyMs: 0, bytes: 0, retries: 0, requestMs: 0, phase: "token", outcome: "loading", cacheHit: false };
		const finish = (outcome) => { metrics.requestMs = performance.now() - started; metrics.outcome = outcome; return { ...metrics }; };
		for (let attempt = 0; ; attempt++) {
			const attemptSignal = AbortSignal.any([operationSignal, AbortSignal.timeout(timeoutMs)]);
			let abort;
			const aborted = new Promise((_, reject) => {
				abort = () => reject(abortError(attemptSignal));
				attemptSignal.addEventListener("abort", abort, { once: true });
				if (attemptSignal.aborted) abort();
			});
			void aborted.catch(() => {});
			const bounded = (promise) => Promise.race([aborted, promise]);
			let failure;
			try {
				attemptSignal.throwIfAborted();
				metrics.phase = "token";
				let mark = performance.now(), token;
				try { token = await bounded(user.getIdToken()); }
				catch (error) { throw error instanceof DocumentError ? error : new DocumentError(error?.code === "auth/network-request-failed" ? "network" : "unauthorized"); }
				finally { metrics.tokenMs += performance.now() - mark; }
				attemptSignal.throwIfAborted();
				metrics.phase = "headers"; mark = performance.now();
				let response;
				try { response = await bounded(fetchImpl(url.href, { method: "GET", cache: "no-store", credentials: "omit", redirect: "error", headers: { Authorization: `Bearer ${token}` }, signal: attemptSignal })); }
				finally { metrics.headersMs += performance.now() - mark; }
				metrics.status = response.status;
				if (!response.ok) {
					void response.body?.cancel().catch(() => {});
					const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
					throw new DocumentError(({ 401: "unauthorized", 403: "forbidden", 404: "not-found", 429: "rate-limited" })[response.status] || (response.status >= 500 ? "server" : "http"), { status: response.status, retryAfterMs, retryAt: retryAfterMs === null ? null : Date.now() + retryAfterMs });
				}
				if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new DocumentError("schema");
				const limit = mode === "metadata" ? LIMITS.payloadBytes : LIMITS.singlePayloadBytes;
				if (Number(response.headers.get("content-length")) > limit) { void response.body?.cancel().catch(() => {}); throw new DocumentError("limit"); }
				const reader = response.body?.getReader();
				if (!reader) throw new DocumentError("schema");
				const decoder = new TextDecoder("utf-8", { fatal: true });
				const decode = (bytes, stream = false) => { try { return decoder.decode(bytes, { stream }); } catch { throw new DocumentError("schema"); } };
				let text = "", bytes = 0;
				metrics.phase = "body"; mark = performance.now();
				try {
					while (true) {
						const chunk = await bounded(reader.read());
						if (chunk.done) break;
						bytes += chunk.value.byteLength; metrics.bytes += chunk.value.byteLength;
						if (bytes > limit) throw new DocumentError("limit");
						text += decode(chunk.value, true);
					}
					text += decode();
				} finally { metrics.bodyMs += performance.now() - mark; void reader.cancel().catch(() => {}); }
				metrics.phase = "schema";
				let payload;
				try { payload = JSON.parse(text); } catch { throw new DocumentError("schema"); }
				const mapped = mode === "metadata" ? { files: validateFiles(payload) } : { document: validateSingleDocument(payload, url.searchParams.get("path")) };
				const cacheControl = response.headers.get("cache-control");
				return { ...mapped, cachePolicy: cacheControl === null ? "unknown" : /(?:^|,)\s*no-store\s*(?:,|$)/i.test(cacheControl) ? "no-store" : "unsafe", metrics: finish("ready") };
			} catch (error) {
				failure = attemptSignal.aborted ? abortError(attemptSignal) : error instanceof DocumentError ? error : new DocumentError(error instanceof TypeError ? "network" : "schema");
				if (failure.abortReason) metrics.abortReason = failure.abortReason;
			} finally { attemptSignal.removeEventListener("abort", abort); }
			if (operationSignal.aborted || attempt >= Math.min(2, maxRetries) || retryDelay(failure, attempt, () => 0) === null) {
				failure.metrics = finish(failure.code);
				throw failure;
			}
			const delay = retryDelay(failure, attempt, random);
			metrics.phase = "backoff";
			onState?.({ state: "retrying", attempt: attempt + 1, delayMs: delay, code: failure.code });
			try { await sleep(delay, operationSignal); }
			catch {
				const error = operationSignal.reason?.name === "TimeoutError" && failure.status === 429 ? failure : new DocumentError(operationSignal.reason?.name === "TimeoutError" ? "timeout" : "abort", { retryAt: failure.retryAt });
				error.metrics = finish(error.code); throw error;
			}
			if (operationSignal.aborted) {
				const code = operationSignal.reason?.name === "TimeoutError" ? "timeout" : "abort";
				throw new DocumentError(code, { metrics: finish(code) });
			}
			metrics.retries = attempt + 1;
		}
	}
	return {
		listDocuments(user, signal, options) {
			const url = new URL(DOCUMENT_ENDPOINT); url.searchParams.set("includeContent", "false");
			return request(user, url, "metadata", signal, options);
		},
		loadDocument(user, path, signal, options) {
			if (!validDocumentPath(path)) return Promise.reject(new DocumentError("schema"));
			const url = new URL(SINGLE_DOCUMENT_ENDPOINT); url.searchParams.set("path", path);
			return request(user, url, "document", signal, options);
		},
	};
}
