import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diagramAllowed } from "../reader/diagram-policy.js";

test("F01 accepts the fixture and bounded plain flowchart statement syntax", () => {
	const fixture = readFileSync(
		new URL("../reader/fixtures/guide.md", import.meta.url),
		"utf8",
	).match(/```mermaid\r?\n([\s\S]+?)```/)[1];
	for (const code of [
		fixture,
		"flowchart LR; A-->B; B-->C",
		"graph TD\r\nA[Reader] --> B[Article]",
		'flowchart LR\n%% style and click are comments\nA["plain; label"]-->B',
	])
		assert.equal(diagramAllowed(code), true, code);
});
test("F01 rejects equivalent commands, config, ambiguity and unsupported diagram syntax", () => {
	for (const command of [
		"style A fill:red",
		'click A "https://example.invalid"',
		"classDef default fill:red",
		"linkStyle 0 stroke:red",
		"class A custom",
	]) {
		for (const separator of [
			";",
			";\t",
			"\n",
			"\r\n",
			"\r",
			"\n\t",
			" %% comment\n",
		])
			assert.equal(
				diagramAllowed(`flowchart LR\nA-->B${separator}${command}`),
				false,
				separator + command,
			);
	}
	for (const code of [
		'%%{init:{"securityLevel":"loose"}}%%\nflowchart LR; A-->B',
		"---\nconfig: x\n---\nflowchart LR; A-->B",
		"flowchart LR\nA[<img src=x>]-->B",
		'flowchart LR\nA@{img:"x"}-->B',
		"sequenceDiagram\nA->>B: x",
		"flowchart LR\nsubgraph x\nA-->B\nend",
		"flowchart LR\nA-->B\u2028click A x",
		'flowchart LR\nA["unclosed]-->B',
		"flowchart LR\nA-->B\\nclick A x",
		"flowchart LR\nA-->B:::red",
		"flowchart LR\nA-->B\nclassDef red color:red",
	])
		assert.equal(diagramAllowed(code), false, code);
	assert.equal(
		diagramAllowed(
			"flowchart LR\n" +
				Array.from({ length: 101 }, (_, i) => `A${i}-->A${i + 1}`).join(
					";",
				),
		),
		false,
	);
});
