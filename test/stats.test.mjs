// The install counts in index.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIndex } from "../scripts/lib/catalog.mjs";
import { fetchInstalls, themeInstalls } from "../scripts/lib/stats.mjs";

async function gallery() {
  const root = await mkdtemp(join(tmpdir(), "themes-stats-"));
  for (const id of ["plain", "dusk"]) {
    await mkdir(join(root, "themes", id), { recursive: true });
    const meta = { id, name: id, created: `2026-10-0${id.length}`, updated: "2026-10-09", previews: [] };
    await writeFile(join(root, "themes", id, "meta.json"), JSON.stringify(meta));
  }
  return root;
}

const listed = async (root) =>
  Object.fromEntries(
    JSON.parse(await readFile(join(root, "index.json"), "utf8")).themes.map((t) => [t.id, [t.installs, t.installs30]]),
  );

test("each theme gets its installs, and a rebuild without counts keeps them", async () => {
  const root = await gallery();
  const counts = {
    plugin: { "a.b": { installs: 1, installs30: 1 } },
    theme: { plain: { installs: 12, installs30: 3, updates30: 7, uninstalls: 1 } },
  };
  await writeIndex(root, themeInstalls(counts));
  assert.deepEqual(await listed(root), { plain: [12, 3], dusk: [undefined, undefined] });
  // The publisher's rebuild, or a day the counts couldn't be read.
  await writeIndex(root);
  assert.deepEqual(await listed(root), { plain: [12, 3], dusk: [undefined, undefined] });
});

test("counts that can't be read are null, not an error", async () => {
  assert.equal(await fetchInstalls("http://127.0.0.1:9/api/ext/stats"), null);
});
