import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
function luminance(hex) {
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const channels = [0, 2, 4]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
const blocks = [...css.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
for (const [theme, block] of [
  ["light", blocks[0]],
  ["dark", blocks[0] + blocks[1]],
])
  test(`${theme} theme text, syntax and focus token contrast`, () => {
    const colors = Object.fromEntries(
      [...block.matchAll(/--ks-([a-z-]+):\s*#([\da-f]+)/g)].map((m) => [m[1], luminance(m[2])]),
    );
    const ratio = (a, b) =>
      (Math.max(colors[a], colors[b]) + 0.05) / (Math.min(colors[a], colors[b]) + 0.05);
    for (const [a, b] of [
      ["text", "canvas"],
      ["text", "surface"],
      ["muted", "canvas"],
      ["muted", "surface"],
      ["link", "canvas"],
      ["link", "surface"],
      ["keyword", "code"],
      ["string", "code"],
      ["muted", "code"],
      ["note-text", "note"],
    ])
      assert.ok(ratio(a, b) >= 4.5, `${a}/${b}: ${ratio(a, b)}`);
    for (const background of ["canvas", "surface", "code"])
      assert.ok(ratio("focus", background) >= 3, `focus/${background}`);
    assert.ok(ratio("border", "surface") >= 3);
    assert.ok(ratio("on-brand", "brand") >= 4.5);
    assert.ok(ratio("brand-caption", "surface") >= 4.5);
    for (const background of ["article", "elevated"]) {
      for (const foreground of ["text", "muted", "link"])
        assert.ok(ratio(foreground, background) >= 4.5, `${foreground}/${background}`);
      assert.ok(ratio("focus", background) >= 3, `focus/${background}`);
      assert.ok(ratio("border", background) >= 3, `border/${background}`);
    }
  });
