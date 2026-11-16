export const DOCUMENT_ENDPOINT = "https://us-central1-source-c3817.cloudfunctions.net/getKnowledgeBaseFiles";
// Bounds accommodate ~98 documents while preserving the existing renderer's 150k-character limit.
export const LIMITS = Object.freeze({ files: 1000, fileBytes: 600_000, contentChars: 150_000, payloadBytes: 32 * 1024 * 1024 });
export class DocumentError extends Error {
	constructor(code) {
		super(code);
		this.code = code;
	}
}
export function validDocumentPath(path) {
	if (typeof path !== "string" || !path || path.length > 2048 || !/\.md$/i.test(path) || /[\\%:?#\u0000-\u001f\u007f]/u.test(path)) return false;
	try { encodeURIComponent(path); } catch { return false; }
	return path.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}
export function validateFiles(payload, full = false) {
	if (!payload || !Array.isArray(payload.files)) throw new DocumentError("schema");
	if (payload.files.length > LIMITS.files) throw new DocumentError("limit");
	const paths = new Set();
	let total = 0;
	return payload.files.map((file) => {
		if (!file || !validDocumentPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.updated !== "string" || !/^\d{4}-\d\d-\d\dT/.test(file.updated) || !Number.isFinite(Date.parse(file.updated)) || paths.has(file.path) || (full && typeof file.content !== "string")) throw new DocumentError("schema");
		paths.add(file.path);
		total += file.bytes;
		if (file.bytes > LIMITS.fileBytes || total > LIMITS.payloadBytes || (full && (file.content.length > LIMITS.contentChars || new TextEncoder().encode(file.content).length > LIMITS.fileBytes))) throw new DocumentError("limit");
		return { path: file.path, bytes: file.bytes, updated: file.updated, ...(full ? { content: file.content } : {}) };
	});
}
export function createDocumentApi({ fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
	async function request(user, full, signal) {
		if (!user) throw new DocumentError("login-required");
		const deadline = AbortSignal.timeout(timeoutMs);
		const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
		let rejectAbort;
		const aborted = new Promise((_, reject) => {
			rejectAbort = () => reject(new DocumentError(requestSignal.reason?.name === "TimeoutError" ? "timeout" : "abort"));
			requestSignal.addEventListener("abort", rejectAbort, { once: true });
			if (requestSignal.aborted) rejectAbort();
		});
		const bounded = (promise) => Promise.race([promise, aborted]);
		try {
			let token;
			try { token = await bounded(user.getIdToken()); }
			catch (error) {
				if (error instanceof DocumentError) throw error;
				throw new DocumentError(error.code === "auth/network-request-failed" ? "network" : "unauthorized");
			}
			if (requestSignal.aborted) throw new DocumentError("abort");
			const response = await bounded(fetchImpl(DOCUMENT_ENDPOINT + (full ? "" : "?includeContent=false"), {
				method: "GET", cache: "no-store", credentials: "omit", redirect: "error",
				headers: { Authorization: `Bearer ${token}` }, signal: requestSignal,
			}));
			if (!response.ok) {
				void response.body?.cancel().catch(() => {});
				throw new DocumentError(({ 401: "unauthorized", 403: "forbidden", 404: "not-found" })[response.status] || (response.status >= 500 ? "server" : "http"));
			}
			if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new DocumentError("schema");
			if (Number(response.headers.get("content-length")) > LIMITS.payloadBytes) throw new DocumentError("limit");
			const reader = response.body?.getReader();
			if (!reader) throw new DocumentError("schema");
			const decoder = new TextDecoder("utf-8", { fatal: true });
			const decode = (bytes, stream = false) => {
				try { return decoder.decode(bytes, { stream }); }
				catch { throw new DocumentError("schema"); }
			};
			let text = "", bytes = 0;
			try {
				while (true) {
					const chunk = await bounded(reader.read());
					if (chunk.done) break;
					bytes += chunk.value.byteLength;
					if (bytes > LIMITS.payloadBytes) throw new DocumentError("limit");
					text += decode(chunk.value, true);
				}
				text += decode();
			} finally { void reader.cancel().catch(() => {}); }
			let payload;
			try { payload = JSON.parse(text); } catch { throw new DocumentError("schema"); }
			const files = validateFiles(payload, full);
			const cacheControl = response.headers.get("cache-control");
			return { files, cachePolicy: cacheControl === null ? "unknown" : /(?:^|,)\s*no-store\s*(?:,|$)/i.test(cacheControl) ? "no-store" : "unsafe" };
		} catch (error) {
			if (requestSignal.aborted) throw new DocumentError(requestSignal.reason?.name === "TimeoutError" ? "timeout" : "abort");
			throw error instanceof DocumentError ? error : new DocumentError(error instanceof TypeError ? "network" : "schema");
		} finally {
			requestSignal.removeEventListener("abort", rejectAbort);
		}
	}
	return {
		listDocuments: (user, signal) => request(user, false, signal),
		loadAllDocumentContents: (user, signal) => request(user, true, signal),
	};
}
