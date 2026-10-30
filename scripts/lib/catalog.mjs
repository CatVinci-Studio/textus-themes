// themes/<id>/meta.json -> index.json, the catalog the website and Textus
// read, with each theme's installs. Themes waiting for review live in
// pending/<id>/ and never reach it.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function readThemes(root, folder = "themes") {
  const dir = join(root, folder);
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

/** Newest first; the same input always gives the same file. `installs`:
 *  each theme's `{installs, installs30}` by id (see stats.mjs). */
export function buildIndex(metas, installs = {}) {
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
      ...(m.darkCss ? { darkCss: `themes/${m.id}/${m.darkCss}` } : {}),
      previews: (m.previews ?? []).map((p) => `themes/${m.id}/${p}`),
      // Words in another UI language (`zh`), over the English ones.
      ...(m.l10n ? { l10n: m.l10n } : {}),
      ...installs[m.id],
    }));
  const updated = themes.reduce((max, t) => (String(t.updated) > max ? String(t.updated) : max), "");
  return { version: 1, updated: updated || null, count: themes.length, themes };
}

/** The installs `index` lists, by theme id. */
export function installsIn(index) {
  const out = {};
  for (const t of index?.themes ?? [])
    if (Number.isInteger(t.installs) && Number.isInteger(t.installs30))
      out[t.id] = { installs: t.installs, installs30: t.installs30 };
  return out;
}

/** Writes index.json, with `installs`, or else the ones it lists now. */
export async function writeIndex(root, installs) {
  const file = join(root, "index.json");
  const kept = await readFile(file, "utf8").then(JSON.parse, () => null);
  const index = buildIndex(await readThemes(root), installs ?? installsIn(kept));
  await writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
