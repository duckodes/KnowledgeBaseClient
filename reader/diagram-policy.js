// Supported subset: flowchart direction, plain rectangular nodes/arrows, and single-line accessibility text.
// Unknown Mermaid syntax is rejected before its parser or renderer touches the host document.
const reserved = new Set([
	"style",
	"click",
	"classdef",
	"linkstyle",
	"class",
	"subgraph",
	"end",
	"direction",
	"flowchart",
	"graph",
	"config",
]);
const plainText = (value) =>
	/^[\p{L}\p{M}\p{N} .,，。:：;；_()（）/+-]+$/u.test(value);

function statements(code) {
	const result = [];
	let text = "",
		bracket = false,
		quote = false,
		comment = false;
	const flush = () => {
		if (text.trim()) result.push(text.trim());
		text = "";
	};
	for (const ch of code.replace(/\r\n?/g, "\n")) {
		if (comment) {
			if (ch !== "\n") continue;
			comment = false;
		}
		if (ch === "\n") {
			if (bracket || quote) return null;
			flush();
			continue;
		}
		if (!bracket && text.endsWith("%") && ch === "%") {
			text = text.slice(0, -1);
			comment = true;
			continue;
		}
		if (ch === '"') {
			if (!bracket) return null;
			quote = !quote;
		}
		if (!quote && ch === "[") {
			if (bracket) return null;
			bracket = true;
		}
		if (!quote && ch === "]") {
			if (!bracket) return null;
			bracket = false;
		}
		if (ch === ";" && !bracket) flush();
		else text += ch;
	}
	if (bracket || quote) return null;
	flush();
	return result;
}

function nodeChain(text) {
	let offset = 0,
		edges = 0;
	const space = () => {
		while (/[ \t]/.test(text[offset] || "") && offset < text.length)
			offset++;
	};
	const node = () => {
		space();
		const id = text.slice(offset).match(/^[A-Za-z][A-Za-z0-9_]*/)?.[0];
		if (!id || reserved.has(id.toLowerCase())) return false;
		offset += id.length;
		space();
		if (text[offset] === "[") {
			const end = text.indexOf("]", offset + 1);
			if (end < 0) return false;
			let label = text.slice(offset + 1, end).trim();
			if (label.startsWith('"') && label.endsWith('"'))
				label = label.slice(1, -1);
			if (!plainText(label)) return false;
			offset = end + 1;
		}
		space();
		return true;
	};
	if (!node()) return -1;
	while (offset < text.length) {
		if (text.slice(offset, offset + 3) !== "-->") return -1;
		offset += 3;
		edges++;
		if (!node()) return -1;
	}
	return edges;
}

export function diagramAllowed(code) {
	if (
		typeof code !== "string" ||
		code.length > 12000 ||
		/%%\{|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]|\p{Cf}/u.test(
			code,
		)
	)
		return false;
	const parts = statements(code);
	if (
		!parts ||
		!/^(?:flowchart|graph)[ \t]+(?:LR|RL|TB|BT|TD)$/.test(
			parts.shift() || "",
		) ||
		!parts.length
	)
		return false;
	let edges = 0,
		nodes = false;
	for (const part of parts) {
		const metadata = part.match(/^acc(?:Title|Descr):[ \t]*(.+)$/);
		if (metadata) {
			if (!plainText(metadata[1])) return false;
			continue;
		}
		const count = nodeChain(part);
		if (count < 0) return false;
		edges += count;
		nodes = true;
	}
	return nodes && edges <= 100;
}
