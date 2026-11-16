import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentApi, validateFiles, LIMITS } from "../reader/document-api.js";

const file = { path: "06_架構/README.md", bytes: 42, updated: "2026-11-10T06:02:12.353Z", content: "# Synthetic" };
const user = { getIdToken: async () => "synthetic-token" };
const json = (payload, headers = {}) => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json", "cache-control": "private, no-store", ...headers } });
const code = (expected) => (error) => error.code === expected && error.message === expected;

test("API validates metadata/full schemas and maps only supported fields", () => {
	assert.deepEqual(validateFiles({ files: [file] }), [{ path: file.path, bytes: file.bytes, updated: file.updated }]);
	assert.deepEqual(validateFiles({ files: [file] }, true), [file]);
	assert.deepEqual(validateFiles({ files: [] }), []);
	assert.equal(validateFiles({ files: Array.from({ length: 98 }, (_, i) => ({ ...file, path: `${i}/README.md` })) }).length, 98);
	for (const payload of [null, {}, { files: {} }, { files: [null] }, { files: [file, file] }]) assert.throws(() => validateFiles(payload), code("schema"));
	for (const field of [{ path: "" }, { bytes: -1 }, { bytes: 1.1 }, { bytes: "42" }, { updated: "not-date" }, { updated: 123 }, { content: null }, { content: undefined }]) assert.throws(() => validateFiles({ files: [{ ...file, ...field }] }, true), code("schema"));
});
test("API rejects traversal, ambiguous encoding and malformed Unicode paths", () => {
	for (const path of ["../x.md", "a/../x.md", "/x.md", "a//x.md", "a/./x.md", "a\\x.md", "%2e%2e/x.md", "x%ZZ.md", "x\ud800.md", "x\u0000.md", "https://x.md", "x.md#fragment"]) assert.throws(() => validateFiles({ files: [{ ...file, path }] }), code("schema"));
	assert.equal(validateFiles({ files: [{ ...file, path: "資料夾/文 件+😀.md" }] })[0].path, "資料夾/文 件+😀.md");
});
test("API bounds document count, individual content and aggregate declared size", () => {
	assert.throws(() => validateFiles({ files: Array(LIMITS.files + 1).fill(file) }), code("limit"));
	assert.throws(() => validateFiles({ files: [{ ...file, bytes: LIMITS.fileBytes + 1 }] }), code("limit"));
	assert.throws(() => validateFiles({ files: [{ ...file, content: "x".repeat(LIMITS.contentChars + 1) }] }, true), code("limit"));
	assert.throws(() => validateFiles({ files: Array.from({ length: 60 }, (_, i) => ({ ...file, bytes: LIMITS.fileBytes, path: `${i}.md` })) }), code("limit"));
});
test("API sends bearer only in headers, uses metadata/full endpoints, checks cache policy", async () => {
	const calls = [];
	const api = createDocumentApi({ fetchImpl: async (url, options) => { calls.push({ url, options }); return json({ files: [file] }); } });
	assert.equal((await api.listDocuments(user)).cachePolicy, "no-store");
	assert.equal((await api.loadAllDocumentContents(user)).files[0].content, file.content);
	assert.match(calls[0].url, /\?includeContent=false$/);
	assert.ok(!calls[1].url.includes("?"));
	for (const { url, options } of calls) {
		assert.ok(!url.includes("synthetic-token"));
		assert.equal(options.headers.Authorization, "Bearer synthetic-token");
		assert.equal(options.cache, "no-store");
		assert.equal(options.redirect, "error");
		assert.equal(options.credentials, "omit");
	}
	for (const [header, expected] of [[null, "unknown"], ["public, max-age=3600", "unsafe"]]) {
		const response = json({ files: [] });
		if (header) response.headers.set("cache-control", header); else response.headers.delete("cache-control");
		assert.equal((await createDocumentApi({ fetchImpl: async () => response }).listDocuments(user)).cachePolicy, expected);
	}
});
test("API distinguishes HTTP errors without parsing or exposing server error bodies", async () => {
	for (const [status, expected] of [[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [500, "server"], [503, "server"], [429, "http"]]) {
		let calls = 0;
		const api = createDocumentApi({ fetchImpl: async () => { calls++; return new Response("sensitive body must not appear", { status }); } });
		await assert.rejects(api.listDocuments(user), code(expected));
		assert.equal(calls, 1);
	}
});
test("API rejects invalid JSON, missing content, wrong MIME, invalid UTF-8 and wire limits", async () => {
	for (const response of [new Response("{", { headers: { "content-type": "application/json" } }), json({ files: [{ ...file, content: null }] }), new Response("{}", { headers: { "content-type": "text/html" } }), new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })]) {
		await assert.rejects(createDocumentApi({ fetchImpl: async () => response }).loadAllDocumentContents(user), code("schema"));
	}
	for (const response of [json({ files: [] }, { "content-length": String(LIMITS.payloadBytes + 1) }), new Response(new Uint8Array(LIMITS.payloadBytes + 1), { headers: { "content-type": "application/json" } })]) await assert.rejects(createDocumentApi({ fetchImpl: async () => response }).listDocuments(user), code("limit"));
});
test("API handles absent login, network failure, deadline and caller abort including token acquisition", async () => {
	let fetches = 0;
	const api = createDocumentApi({ fetchImpl: async () => { fetches++; throw new TypeError("private details"); } });
	await assert.rejects(api.listDocuments(null), code("login-required"));
	assert.equal(fetches, 0);
	await assert.rejects(api.listDocuments(user), code("network"));
	const brokenStream = new ReadableStream({ start(controller) { controller.error(new TypeError("connection lost")); } });
	await assert.rejects(createDocumentApi({ fetchImpl: async () => new Response(brokenStream, { headers: { "content-type": "application/json" } }) }).listDocuments(user), code("network"));
	await assert.rejects(api.listDocuments({ getIdToken: async () => { throw { code: "auth/user-token-expired" }; } }), code("unauthorized"));
	await assert.rejects(api.listDocuments({ getIdToken: async () => { throw { code: "auth/network-request-failed" }; } }), code("network"));
	const controller = new AbortController();
	const waiting = createDocumentApi({ fetchImpl: () => new Promise(() => {}) }).listDocuments(user, controller.signal);
	controller.abort();
	await assert.rejects(waiting, code("abort"));
	await assert.rejects(api.listDocuments(user, controller.signal), code("abort"));
	const keepAlive = setTimeout(() => {}, 1000);
	try {
		await assert.rejects(createDocumentApi({ timeoutMs: 5, fetchImpl: () => new Promise(() => {}) }).listDocuments(user), code("timeout"));
		await assert.rejects(createDocumentApi({ timeoutMs: 5 }).listDocuments({ getIdToken: () => new Promise(() => {}) }), code("timeout"));
	} finally { clearTimeout(keepAlive); }
});
