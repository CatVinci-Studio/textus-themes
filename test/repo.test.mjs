// The published catalog itself: every theme passes the same checks a new
// one would, and index.json matches themes/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, readThemes } from "../scripts/lib/catalog.mjs";
import { LIMITS, sniffImage, validateCss } from "../scripts/lib/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every published theme is valid", async () => {
  const metas = await readThemes(root);
  assert.ok(metas.length > 0);
  for (const m of metas) {
    const css = await readFile(join(root, "themes", m.id, m.css), "utf8");
    assert.deepEqual(validateCss(css).errors, [], m.id);
    assert.ok(m.previews.length >= 1 && m.previews.length <= LIMITS.images, m.id);
    for (const p of m.previews) {
      const buf = await readFile(join(root, "themes", m.id, p));
      assert.ok(buf.length <= LIMITS.imageBytes, `${m.id}/${p} size`);
      assert.equal(sniffImage(buf), p.split(".").pop(), `${m.id}/${p} type`);
    }
  }
});

test("no theme repeats one of Textus's built-in themes", async () => {
  const builtin = new Set(["default", "paper", "slate", "forest", "parchment"]);
  for (const m of await readThemes(root)) assert.ok(!builtin.has(m.id) && !builtin.has(m.name.toLowerCase()), m.id);
});

test("index.json is up to date (run `npm run index`)", async () => {
  const onDisk = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
  assert.deepEqual(onDisk, buildIndex(await readThemes(root)));
});
