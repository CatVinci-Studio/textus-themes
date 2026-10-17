// themes/<id>/meta.json -> index.json, the catalog the website reads.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function readThemes(root) {
  const dir = join(root, "themes");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const metas = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      metas.push(JSON.parse(await readFile(join(dir, e.name, "meta.json"), "utf8")));
    } catch {
      /* a folder without meta.json is not a theme */
    }
  }
  return metas;
}

/** Newest first; the same input always gives the same file. */
export function buildIndex(metas) {
  const themes = [...metas]
    .sort((a, b) => String(b.created).localeCompare(String(a.created)) || a.id.localeCompare(b.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      author: m.author,
      description: m.description,
      license: m.license,
      source: m.source ?? null,
      created: m.created,
      updated: m.updated,
      css: `themes/${m.id}/${m.css ?? "theme.css"}`,
      previews: (m.previews ?? []).map((p) => `themes/${m.id}/${p}`),
    }));
  const updated = themes.reduce((max, t) => (String(t.updated) > max ? String(t.updated) : max), "");
  return { version: 1, updated: updated || null, count: themes.length, themes };
}

export async function writeIndex(root) {
  const index = buildIndex(await readThemes(root));
  await writeFile(join(root, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
