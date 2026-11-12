import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.spec.js",
	timeout: 30000,
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:31338",
		headless: true,
		channel: "chrome",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "node scripts/preview.mjs 31338 --test",
		url: "http://127.0.0.1:31338/reader.html",
		reuseExistingServer: false,
	},
	reporter: [
		["list"],
		["json", { outputFile: "test-results/results.json" }],
		["html", { open: "never" }],
	],
});
