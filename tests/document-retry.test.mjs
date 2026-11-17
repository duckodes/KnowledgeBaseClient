import test from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfter, retryDelay, waitForRetry, DocumentError } from "../reader/document-api.js";

test("Retry-After accepts seconds or dates, and rejects invalid or past values", () => {
	const now = Date.parse("2026-11-17T00:00:00Z");
	assert.equal(parseRetryAfter("2", now), 2000);
	assert.equal(parseRetryAfter("Tue, 17 Nov 2026 00:00:04 GMT", now), 4000);
	for (const header of [null, "", "garbage", "-2", "1.5", "Mon, 16 Nov 2026 00:00:00 GMT"]) assert.equal(parseRetryAfter(header, now), null);
});
test("retry allowlist uses bounded exponential jitter and respects Retry-After", () => {
	for (const code of ["network", "timeout"]) {
		assert.equal(retryDelay(new DocumentError(code), 0, () => 0), 250);
		assert.equal(retryDelay(new DocumentError(code), 1, () => 1), 1000);
	}
	for (const status of [429, 502, 503, 504]) assert.equal(retryDelay(new DocumentError("http", { status, retryAfterMs: 3000 }), 1, () => 0), 3000);
	for (const code of ["abort", "schema", "limit", "unauthorized", "forbidden"]) assert.equal(retryDelay(new DocumentError(code), 0), null);
	for (const status of [400, 401, 403, 404, 500, 501]) assert.equal(retryDelay(new DocumentError("http", { status }), 0), null);
});
test("backoff can be cancelled and does not retain a failing timer", async () => {
	const controller = new AbortController();
	const waiting = waitForRetry(60_000, controller.signal);
	controller.abort();
	await assert.rejects(waiting, { code: "abort" });
	await assert.rejects(waitForRetry(1, controller.signal), { code: "abort" });
	await waitForRetry(1, new AbortController().signal);
});
