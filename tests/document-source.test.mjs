import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DocumentSource } from "../reader/document-source.js";
import { DocumentError } from "../reader/document-api.js";
const a = { uid: "a" }, b = { uid: "b" };
const files = [{ path: "one/README.md", bytes: 5, updated: "2026-11-10T00:00:00Z", content: "# One" }, { path: "two/README.md", bytes: 5, updated: "2026-11-10T00:00:00Z", content: "# Two" }];
const result = { files, cachePolicy: "no-store" };
function setup(options = {}) {
	const calls = [];
	const api = {
		listDocuments: async (user) => { calls.push(["list", user.uid]); return result; },
		loadDocument: async (user, path) => { calls.push(["single", user.uid, path]); return { document: files.find((file) => file.path === path), cachePolicy: "no-store" }; },
	};
	return { source: new DocumentSource({ api, ...options }), api, calls };
}
test("source only loads paths in authenticated metadata; never fetches anonymously or bulk", async () => {
	const { source, calls } = setup();
	await assert.rejects(source.listDocuments(), { code: "login-required" });
	await assert.rejects(source.loadDocument(files[0].path), { code: "login-required" });
	assert.equal(calls.length, 0);
	source.setUser(a);
	assert.equal((await source.listDocuments()).size, 2);
	assert.deepEqual(calls, [["list", "a"]]);
	for (const path of ["unknown.md", "../one/README.md"]) await assert.rejects(source.loadDocument(path), { code: "missing" });
	assert.equal(calls.length, 1);
});
test("reader exclusions remove internal documents before navigation, caching or single fetch", async () => {
	const { source, api, calls } = setup();
	const excluded = [
		"AGENTS.md", "nested/agents.MD", "analysis-reprt.md", "nested/analysis-report.md",
		"analysis-report/details.md", "analysis-reprt/details.md", "00_AI檢索地圖與回答規則.md",
		"nested/00_AI檢索地圖與回答規則.md",
		"analysis-report-ai/README.md", "analysis-report-ai/nested/change.md", "nested/ANALYSIS-REPORT-AI/README.md",
	];
	const visible = ["README.md", "nested/README.md", "analysis-reporting.md", "nested/AGENTS-guide.md", "analysis-report-ai-guide.md", "analysis-report-ai-archive/README.md", "analysis-reprt-ai/README.md"];
	api.listDocuments = async () => ({ ...result, files: [...excluded, ...visible].map((path) => ({ ...files[0], path })) });
	source.setUser(a);
	assert.deepEqual([...(await source.listDocuments()).keys()], visible);
	for (const path of excluded) await assert.rejects(source.loadDocument(path), { code: "missing" });
	assert.equal(calls.length, 0);
	assert.equal(source.cache.size, 0);
	assert.equal(source.flights.size, 0);
});

test("per-document cache hits, misses, single-flight and TTL do not extend age", async () => {
	let now = 0;
	const { source, api, calls } = setup({ now: () => now, ttl: 100 });
	source.setUser(a);
	await source.listDocuments();
	const gate = Promise.withResolvers();
	const read = api.loadDocument;
	api.loadDocument = async (...args) => { await gate.promise; return read(...args); };
	const one = source.loadDocument(files[0].path), same = source.loadDocument(files[0].path), two = source.loadDocument(files[1].path);
	gate.resolve();
	assert.equal((await one).text, "# One");
	assert.equal((await same).text, "# One");
	assert.equal((await two).text, "# Two");
	assert.equal(calls.length, 3);
	now = 90;
	assert.equal((await source.loadDocument(files[0].path)).expires, 100);
	assert.equal(source.metrics.document.cacheHit, true);
	assert.equal(calls.length, 3);
	now = 100;
	await source.loadDocument(files[0].path);
	assert.equal(calls.length, 4);
	assert.equal(source.cache.size, 1);
});
test("metadata refresh preserves matching versions and invalidates changes/removals", async () => {
	const { source, api, calls } = setup();
	source.setUser(a);
	await source.listDocuments();
	await source.loadDocument(files[0].path);
	await source.loadDocument(files[1].path);
	await source.listDocuments();
	await source.loadDocument(files[0].path);
	assert.equal(calls.filter(([kind]) => kind === "single").length, 2);
	api.listDocuments = async () => ({ ...result, files: [{ ...files[0], updated: "2026-11-11T00:00:00Z" }] });
	await source.listDocuments();
	assert.equal(source.cache.size, 0);
	await assert.rejects(source.loadDocument(files[1].path), { code: "missing" });
});
test("cache has both LRU entry and estimated UTF-16 memory bounds", async () => {
	for (const limits of [{ entries: 1, bytes: 4096 }, { entries: 20, bytes: 310 }]) {
		const { source } = setup({ limits });
		source.setUser(a); await source.listDocuments();
		await source.loadDocument(files[0].path); await source.loadDocument(files[1].path);
		assert.equal(source.cache.size, 1);
		assert.ok(source.cache.has(files[1].path));
		assert.ok(source.cacheBytes <= limits.bytes);
	}
});
test("sign-out/user switch clears cache, metadata, flights and aborts pending requests", async () => {
	const { source } = setup();
	for (const next of [null, b, { uid: "a" }]) {
		source.setUser(a); await source.listDocuments(); await source.loadDocument(files[0].path);
		const signal = source.controller.signal;
		source.setUser(next);
		assert.equal(source.cache.size, 0); assert.equal(source.documents.size, 0); assert.equal(source.flights.size, 0); assert.equal(source.cacheBytes, 0);
		assert.ok(signal.aborted);
	}
});
test("401/403 wipe all private entries and map; retries cannot reuse old authorization", async () => {
	for (const code of ["unauthorized", "forbidden"]) {
		const { source, api } = setup();
		source.setUser(a); await source.listDocuments(); await source.loadDocument(files[0].path);
		api.loadDocument = async () => { throw new DocumentError(code); };
		await assert.rejects(source.loadDocument(files[1].path), { code });
		assert.equal(source.documents.size, 0); assert.equal(source.cache.size, 0);
		await assert.rejects(source.loadDocument(files[0].path), { code: "missing" });
	}
});
test("late metadata and single responses never populate a new session", async () => {
	for (const operation of ["listDocuments", "loadDocument"]) {
		const { source, api } = setup();
		source.setUser(a); await source.listDocuments();
		const gate = Promise.withResolvers();
		api[operation] = () => gate.promise;
		const pending = operation === "listDocuments" ? source.listDocuments() : source.loadDocument(files[0].path);
		source.setUser(b);
		gate.resolve(operation === "listDocuments" ? result : { document: files[0], cachePolicy: "no-store" });
		await assert.rejects(pending, { code: "abort" });
		assert.equal(source.cache.size, 0); assert.equal(source.documents.size, 0);
	}
});
test("one subscriber abort does not cancel shared work; final abort cancels and prevents cache write", async () => {
	for (const abortBoth of [false, true]) {
		const { source, api } = setup();
		source.setUser(a); await source.listDocuments();
		const gate = Promise.withResolvers(); let shared;
		api.loadDocument = async (user, path, signal) => { shared = signal; await gate.promise; return { document: files[0], cachePolicy: "no-store" }; };
		const c1 = new AbortController(), c2 = new AbortController();
		const one = source.loadDocument(files[0].path, { signal: c1.signal });
		const two = source.loadDocument(files[0].path, { signal: c2.signal });
		c1.abort("route-change"); await assert.rejects(one, { code: "abort" });
		assert.equal(shared.aborted, false);
		if (abortBoth) c2.abort("route-change");
		gate.resolve();
		if (abortBoth) { await assert.rejects(two, { code: "abort" }); assert.ok(shared.aborted); assert.equal(shared.reason, "route-change"); await new Promise((resolve) => setImmediate(resolve)); assert.equal(source.cache.size, 0); }
		else { assert.equal((await two).text, "# One"); assert.equal(source.cache.size, 1); }
	}
});
test("failed promises recover without discarding sidebar; reauthorization failure clears expired content", async () => {
	let now = 0;
	const { source, api } = setup({ now: () => now, ttl: 10 });
	source.setUser(a); await source.listDocuments();
	const read = api.loadDocument;
	api.loadDocument = async () => { throw new DocumentError("network"); };
	await assert.rejects(source.loadDocument(files[0].path), { code: "network" });
	assert.equal(source.documents.size, 2); assert.equal(source.flights.size, 0);
	api.loadDocument = read; await source.loadDocument(files[0].path);
	now = 10;
	api.loadDocument = async () => { throw new DocumentError("forbidden"); };
	await assert.rejects(source.loadDocument(files[0].path), { code: "forbidden" });
	assert.equal(source.cache.size, 0);
});
test("private loading modules have no custom persistence/logging or bulk fallback", async () => {
	for (const name of ["document-source", "document-api"]) {
		const source = await readFile(new URL(`../reader/${name}.js`, import.meta.url), "utf8");
		assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\.|caches\.|loadAllDocumentContents/);
	}
});
