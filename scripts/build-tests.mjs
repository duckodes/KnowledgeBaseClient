import { build } from 'esbuild';
await build({ entryPoints: ['tests/security-entry.js'], bundle: true, format: 'esm', outdir: 'tests/assets', minify: true });
