function scalar(value) {
	if (value.startsWith('"')) {
		const parsed = JSON.parse(value);
		if (typeof parsed !== "string") throw new Error();
		return parsed;
	}
	if (value.startsWith("'")) {
		if (!/^'(?:[^']|'')*'$/.test(value)) throw new Error();
		return value.slice(1, -1).replace(/''/g, "'");
	}
	if (/^[\[\]{}&*!|>@`]/.test(value)) throw new Error();
	return value;
}

// shortcut: flat text fields/lists only; add a YAML parser if richer frontmatter is required.
export function splitFrontmatter(markdown) {
	const unchanged = { body: markdown, fields: [] };
	const fenced = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(markdown);
	const lines = (fenced ? fenced[1] : markdown.replace(/^\uFEFF/, "")).split(/\r?\n/);
	if (!fenced && !/^title:[ \t]+/.test(lines[0])) return unchanged;
	const fields = new Map();
	let current, consumed = 0;
	try {
		for (const line of lines) {
			if (!line.trim()) { consumed++; continue; }
			const field = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
			const item = /^[ \t]*-[ \t]+(.+)$/.exec(line);
			if (field) {
				const [, key, raw] = field, value = raw.trim();
				if (fields.has(key)) return unchanged;
				let parsed;
				if (value.startsWith("[")) {
					parsed = JSON.parse(value);
					if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) return unchanged;
				} else parsed = value ? scalar(value) : [];
				fields.set(key, parsed);
				current = key;
			} else if (item && Array.isArray(fields.get(current))) {
				fields.get(current).push(scalar(item[1].trim()));
			} else if (fenced || /^[ \t]+\S/.test(line)) return unchanged;
			else break;
			consumed++;
		}
	} catch { return unchanged; }
	if (!fields.size || (!fenced && (fields.size < 2 || typeof fields.get("title") !== "string"))) return unchanged;
	return {
		body: fenced ? markdown.slice(fenced[0].length) : lines.slice(consumed).join("\n"),
		fields: [...fields],
	};
}
