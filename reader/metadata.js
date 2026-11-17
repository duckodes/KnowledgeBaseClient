export function formatUpdated(value) {
	if (typeof value !== "string") return "—";
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "—";
	const seconds = /T\d{2}:\d{2}:\d{2}/.test(value);
	const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Taipei", calendar: "gregory", numberingSystem: "latn",
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", hourCycle: "h23",
		...(seconds ? { second: "2-digit" } : {}),
	}).formatToParts(date).map(({ type, value }) => [type, value]));
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}${seconds ? `:${parts.second}` : ""}`;
}
