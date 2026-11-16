import { createDocumentApi, DocumentError } from "./document-api.js";
export const CACHE_TTL = 5 * 60_000;

export class DocumentSource {
	constructor({ api = createDocumentApi(), now = Date.now, ttl = CACHE_TTL } = {}) {
		this.api = api;
		this.now = now;
		this.ttl = ttl;
		this.user = null;
		this.reset();
	}
	reset() {
		this.controller?.abort();
		this.controller = new AbortController();
		this.generation = (this.generation || 0) + 1;
		this.documents = new Map();
		this.contents = null;
		this.flight = null;
		this.expires = 0;
		this.cachePolicy = "unknown";
	}
	setUser(user) {
		this.reset();
		this.user = user;
	}
	async run(operation) {
		if (!this.user) throw new DocumentError("login-required");
		const generation = this.generation;
		try {
			const result = await this.api[operation](this.user, this.controller.signal);
			if (generation !== this.generation) throw new DocumentError("abort");
			this.cachePolicy = result.cachePolicy;
			if (result.cachePolicy === "unsafe") throw new DocumentError("cache");
			return result.files;
		} catch (error) {
			if (generation !== this.generation) throw new DocumentError("abort");
			if (["unauthorized", "forbidden"].includes(error.code)) this.reset();
			throw error;
		}
	}
	async listDocuments() {
		// Refresh discards all previously authorized content before revalidation.
		this.reset();
		const generation = this.generation;
		const files = await this.run("listDocuments");
		if (generation !== this.generation) throw new DocumentError("abort");
		this.documents = new Map(files.map((file) => [file.path, file]));
		return this.documents;
	}
	async loadDocument(path) {
		const generation = this.generation;
		if (!this.user) throw new DocumentError("login-required");
		if (!this.documents.has(path)) throw new DocumentError("missing");
		if (this.contents && this.now() >= this.expires) this.contents = null;
		if (!this.contents) {
			if (!this.flight) {
				const generation = this.generation;
				const flight = this.run("loadAllDocumentContents").then((files) => {
					if (generation !== this.generation) throw new DocumentError("abort");
					this.contents = new Map(files.map((file) => [file.path, file]));
					this.expires = this.now() + this.ttl;
				});
				this.flight = flight;
				void flight.finally(() => { if (this.flight === flight) this.flight = null; }).catch(() => {});
			}
			await this.flight;
		}
		if (generation !== this.generation) throw new DocumentError("abort");
		const file = this.contents.get(path);
		if (!file) throw new DocumentError("missing");
		return { ...file, title: file.path.split("/").at(-1).replace(/\.md$/i, ""), text: file.content };
	}
}
