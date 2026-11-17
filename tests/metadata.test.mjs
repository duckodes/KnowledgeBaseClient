import test from "node:test";
import assert from "node:assert/strict";
import { formatUpdated } from "../reader/metadata.js";

test("updated timestamps display Taiwan time with source precision", () => {
	assert.equal(formatUpdated("2026-11-10T06:02:12.353Z"), "2026-11-10 14:02:12");
	assert.equal(formatUpdated("2026-11-10T06:02:00Z"), "2026-11-10 14:02:00");
	assert.equal(formatUpdated("2026-11-10T06:02Z"), "2026-11-10 14:02");
	assert.equal(formatUpdated("2026-11-10T14:02+08:00"), "2026-11-10 14:02");
});
test("updated formatting preserves date rollovers and midnight hour zero", () => {
	assert.equal(formatUpdated("2026-11-10T16:00:00Z"), "2026-11-11 00:00:00");
	assert.equal(formatUpdated("2026-12-31T23:59Z"), "2027-01-01 07:59");
});
test("invalid display metadata does not invent a timestamp", () => {
	for (const value of [null, undefined, 0, "", "invalid", Symbol("invalid")]) assert.equal(formatUpdated(value), "—");
});
