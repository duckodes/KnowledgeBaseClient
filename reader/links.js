// Only these synthetic source paths are addressable. Never fetch a Markdown URL.
export const fixturePaths = Object.freeze([
	"guide.md",
	"examples/連結 範例.md",
	"safety.md",
]);
export function readerUrl(path, fragment = "", privateSource = false) {
	return `?${privateSource ? "source=knowledge&" : ""}doc=${encodeURIComponent(path)}${fragment ? "#" + encodeURIComponent(fragment) : ""}`;
}
export function resolveLink(raw, source, paths = fixturePaths) {
	if (typeof raw !== "string" || !raw || /[\u0000-\u0020\u007f\\]/u.test(raw))
		return { kind: "blocked" };
	if (/^https?:\/\//i.test(raw)) {
		try {
			const url = new URL(raw);
			return url.username || url.password
				? { kind: "blocked" }
				: { kind: "external", href: url.href };
		} catch {
			return { kind: "blocked" };
		}
	}
	if (
		/^[a-z][a-z\d+.-]*:/i.test(raw) ||
		raw.startsWith("/") ||
		raw.includes("?")
	)
		return { kind: "blocked" };
	const hash = raw.indexOf("#");
	let path, fragment;
	try {
		path = decodeURIComponent(hash < 0 ? raw : raw.slice(0, hash));
		fragment = decodeURIComponent(hash < 0 ? "" : raw.slice(hash + 1));
	} catch {
		return { kind: "blocked" };
	}
	if (
		/[\u0000-\u001f\u007f\\%:?#]/u.test(path) ||
		path.startsWith("/") ||
		/[\u0000-\u001f\u007f]/u.test(fragment)
	)
		return { kind: "blocked" };
	const segments = path ? source.split("/").slice(0, -1) : [];
	for (const segment of path.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (!segments.length) return { kind: "blocked" };
			segments.pop();
		} else segments.push(segment);
	}
	const target = path ? segments.join("/") : source;
	if (!(paths instanceof Map ? paths.has(target) : paths.includes(target))) return { kind: "unavailable" };
	return {
		kind: "local",
		path: target,
		fragment,
		href: readerUrl(target, fragment, paths instanceof Map),
	};
}
