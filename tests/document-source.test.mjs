import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DocumentSource } from "../reader/document-source.js";
import { DocumentError } from "../reader/document-api.js";
const a = { uid: "a" }, b = { uid: "b" };
const files = [{ path: "one/README.md", bytes: 10, updated: "2026-11-10T00:00:00Z", content: "# One" }, { path: "two/README.md", bytes: 10, updated: "2026-11-10T00:00:00Z", content: "# Two" }];
const result = { files, cachePolicy: "no-store" };
const deferred = () => Promise.withResolvers();
function setup(options = {}) {
	const calls = [];
	const api = {
		listDocuments: async (user) => { calls.push(["list", user.uid]); return result; },
		loadAllDocumentContents: async (user) => { calls.push(["full", user.uid]); return result; },
	};
	return { source: new DocumentSource({ api, ...options }), api, calls };
}
test("source never fetches anonymously; auth success lists only metadata", async () => {
	const { source, calls } = setup();
	await assert.rejects(source.listDocuments(), { code: "login-required" });
	await assert.rejects(source.loadDocument(files[0].path), { code: "login-required" });
	assert.equal(calls.length, 0);
	source.setUser(a);
	assert.equal((await source.listDocuments()).size, 2);
	assert.deepEqual(calls, [["list", "a"]]);
	await assert.rejects(source.loadDocument("unknown.md"), { code: "missing" });
	assert.equal(calls.length, 1);
});
test("source single-flights full content, retains exact identities and expires cache", async () => {
	let now = 0;
	const { source, api, calls } = setup({ now: () => now, ttl: 100 });
	source.setUser(a);
	await source.listDocuments();
	const gate = deferred();
	api.loadAllDocumentContents = async () => { calls.push(["full", "a"]); return gate.promise; };
	const one = source.loadDocument(files[0].path), two = source.loadDocument(files[1].path);
	gate.resolve(result);
	assert.equal((await one).text, "# One");
	assert.equal((await two).text, "# Two");
	await source.loadDocument(files[0].path);
	assert.equal(calls.length, 2);
	now = 100;
	await source.loadDocument(files[0].path);
	assert.equal(calls.length, 3);
	await source.listDocuments();
	assert.equal(source.contents, null);
});
test("sign-out, same UID new auth session and user switch clear cache and abort work", async () => {
	const { source } = setup();
	for (const next of [null, b, { uid: "a" }]) {
		source.setUser(a);
		await source.listDocuments();
		await source.loadDocument(files[0].path);
		const signal = source.controller.signal;
		source.setUser(next);
		assert.equal(source.contents, null);
		assert.equal(source.documents.size, 0);
		assert.ok(signal.aborted);
	}
});
test("401/403 discard metadata/content; retries cannot use old authorization", async () => {
	for (const code of ["unauthorized", "forbidden"]) {
		const { source, api } = setup();
		source.setUser(a);
		await source.listDocuments();
		api.loadAllDocumentContents = async () => { throw new DocumentError(code); };
		await assert.rejects(source.loadDocument(files[0].path), { code });
		assert.equal(source.documents.size, 0);
		assert.equal(source.contents, null);
		await assert.rejects(source.loadDocument(files[0].path), { code: "missing" });
	}
});
test("late metadata/full responses cannot populate a new session or reset cache", async () => {
	for (const operation of ["listDocuments", "loadAllDocumentContents"]) {
		const { source, api } = setup();
		source.setUser(a);
		await source.listDocuments();
		const gate = deferred();
		api[operation] = () => gate.promise;
		const pending = operation === "listDocuments" ? source.listDocuments() : source.loadDocument(files[0].path);
		source.setUser(b);
		gate.resolve(result);
		await assert.rejects(pending, { code: "abort" });
		assert.equal(source.contents, null);
		assert.equal(source.documents.size, 0);
	}
});
test("failed full promise is recoverable, missing content is explicit and unsafe caching rejected", async () => {
	const { source, api } = setup();
	source.setUser(a);
	await source.listDocuments();
	api.loadAllDocumentContents = async () => { throw new DocumentError("network"); };
	await assert.rejects(source.loadDocument(files[0].path), { code: "network" });
	api.loadAllDocumentContents = async () => result;
	assert.equal((await source.loadDocument(files[0].path)).text, "# One");
	source.contents = null;
	api.loadAllDocumentContents = async () => ({ ...result, files: [] });
	await assert.rejects(source.loadDocument(files[0].path), { code: "missing" });
	api.listDocuments = async () => ({ ...result, cachePolicy: "unsafe" });
	await assert.rejects(source.listDocuments(), { code: "cache" });
});
test("private adapters contain no persistence or logging paths", async () => {
	for (const name of ["document-api", "document-source"]) {
		assert.doesNotMatch(await readFile(new URL(`../reader/${name}.js`, import.meta.url), "utf8"), /localStorage|sessionStorage|indexedDB|console\./);
	}
});
