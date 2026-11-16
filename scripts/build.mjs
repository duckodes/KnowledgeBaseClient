import { build } from "esbuild";
await build({
	entryPoints: ["reader/reader.js"],
	bundle: true,
	external: ["https://*"],
	splitting: true,
	format: "esm",
	outdir: "reader/assets",
	entryNames: "[name]",
	chunkNames: "chunks/[name]-[hash]",
	minify: true,
	sourcemap: false,
	loader: { ".md": "text" },
	legalComments: "linked",
	target: ["es2022"],
});
console.log("Reader built locally: reader/assets/reader.js");
