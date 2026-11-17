import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFrontmatter } from "../reader/frontmatter.js";
import { documentFields, documentBody } from "./frontmatter-fixture.js";

test("frontmatter separates fields, text lists and body without changing values", () => {
	for (const newline of ["\n", "\r\n"]) {
		const input = `---\n${documentFields}\n---\n${documentBody}`.replaceAll("\n", newline);
		const { fields, body } = splitFrontmatter(input);
		const data = new Map(fields);
		assert.equal(fields.length, 10);
		assert.equal(data.get("status"), "source-traced");
		assert.equal(data.get("source_commit"), "0123456789abcdef0123456789abcdef01234567");
		assert.equal(data.get("related_code").length, 5);
		assert.deepEqual(data.get("audience"), ["RD", "PM"]);
		assert.equal(body, documentBody.replaceAll("\n", newline));
	}
});

test("unwrapped leading metadata is recognized but prose and code stay untouched", () => {
	const parsed = splitFrontmatter(`${documentFields}\n\n${documentBody}`);
	assert.equal(parsed.fields.length, 10);
	assert.equal(parsed.body, documentBody);
	for (const markdown of [documentBody, "title: prose only", `# Body\n\n${documentFields}`, `\`\`\`yaml\n${documentFields}\n\`\`\``]) {
		assert.deepEqual(splitFrontmatter(markdown), { body: markdown, fields: [] });
	}
});

test("quoted scalars and literal unsafe text are not executed or coerced", () => {
	const { fields } = splitFrontmatter(`\uFEFF---\nowner: 'O''Brien'\nbranch: 001\nstatus: "<img src=x onerror=alert(1)>"\n__proto__: literal\n---\n# Test`);
	assert.deepEqual(fields, [["owner", "O'Brien"], ["branch", "001"], ["status", "<img src=x onerror=alert(1)>"], ["__proto__", "literal"]]);
});

test("invalid, duplicate and unsupported YAML is preserved as original Markdown", () => {
	for (const header of [
		'title: "Unclosed', 'title: "A" owner: "B"', 'title: "A"\ntitle: "B"',
		"title: A\nowner:\n  name: nested", 'audience: ["RD", 1]', 'audience: ["RD",',
		"title: &alias A", "title: !!str A", "title: |\n  multiline", "title: 'unclosed",
	]) {
		const markdown = `---\n${header}\n---\n${documentBody}`;
		assert.deepEqual(splitFrontmatter(markdown), { body: markdown, fields: [] });
	}
	const unclosed = `---\n${documentFields}\n${documentBody}`;
	assert.deepEqual(splitFrontmatter(unclosed), { body: unclosed, fields: [] });
});
