// What a published theme must be. Pure: no network, no files.
import postcss from "postcss";

export const LIMITS = {
  cssBytes: 200 * 1024,
  imageBytes: 2 * 1024 * 1024,
  images: 2,
  name: 60,
  description: 300,
};

// OSI-approved licenses, by SPDX id. A blank License field means MIT.
const OSI = [
  "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "ISC",
  "MPL-2.0", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0-only", "LGPL-3.0-or-later",
  "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later",
  "AGPL-3.0-only", "AGPL-3.0-or-later", "Unlicense", "Zlib", "Artistic-2.0",
  "EUPL-1.2", "UPL-1.0", "BSL-1.0", "OFL-1.1", "CECILL-2.1", "MulanPSL-2.0",
];
const ALIASES = {
  "apache 2.0": "Apache-2.0", "apache2": "Apache-2.0", "apache-2": "Apache-2.0", "apache": "Apache-2.0",
  "bsd-2": "BSD-2-Clause", "bsd-3": "BSD-3-Clause", "bsd 2-clause": "BSD-2-Clause", "bsd 3-clause": "BSD-3-Clause",
  "mpl 2.0": "MPL-2.0", "mpl2": "MPL-2.0",
  "gpl-2.0": "GPL-2.0-only", "gplv2": "GPL-2.0-only", "gpl-3.0": "GPL-3.0-only", "gplv3": "GPL-3.0-only",
  "lgpl-2.1": "LGPL-2.1-only", "lgpl-3.0": "LGPL-3.0-only", "lgplv3": "LGPL-3.0-only",
  "agpl-3.0": "AGPL-3.0-only", "agplv3": "AGPL-3.0-only",
  "the unlicense": "Unlicense", "ofl": "OFL-1.1", "sil ofl 1.1": "OFL-1.1", "boost": "BSL-1.0",
  "mulan psl v2": "MulanPSL-2.0",
};
const BY_LOWER = Object.fromEntries(OSI.map((id) => [id.toLowerCase(), id]));

/** The SPDX id for what an author wrote, or null if it isn't one we accept. */
export function normalizeLicense(value) {
  const v = String(value ?? "").trim().replace(/\s+licen[cs]e$/i, "").replace(/^licen[cs]e\s*/i, "").trim();
  if (!v) return "MIT";
  const lower = v.toLowerCase();
  return BY_LOWER[lower] ?? ALIASES[lower] ?? null;
}

/** A folder name from the theme's name: lowercase ASCII words joined by "-". */
export function slugify(name) {
  const slug = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length >= 2 ? slug : null;
}

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** Checks the template's fields; returns { fields, errors }. */
export function validateFields(raw) {
  const errors = [];
  const name = String(raw.name ?? "").trim();
  const description = String(raw.description ?? "").trim();
  if (!name) errors.push("`Name:` is empty.");
  else if ([...name].length > LIMITS.name) errors.push(`\`Name:\` is longer than ${LIMITS.name} characters.`);
  else if (CONTROL.test(name) || /[<>]/.test(name)) errors.push("`Name:` can't contain < > or control characters.");
  if (!description) errors.push("`Description:` is empty: say in a sentence what the theme is like.");
  else if ([...description].length > LIMITS.description) errors.push(`\`Description:\` is longer than ${LIMITS.description} characters.`);
  else if (CONTROL.test(description)) errors.push("`Description:` can't contain control characters.");
  const license = normalizeLicense(raw.license);
  if (!license) errors.push(`\`License:\` "${String(raw.license).trim()}" isn't an OSI-approved SPDX id we know (for example MIT, Apache-2.0, BSD-3-Clause, GPL-3.0-only, OFL-1.1). Leave it blank for MIT.`);
  return { fields: { name, description, license }, errors };
}

// Resolves CSS escapes (`\75 rl(` is `url(`) so a check can't be dodged by
// spelling a word with them.
export function decodeCssEscapes(s) {
  return s.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n0-9a-fA-F])/g, (_, hex, ch) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : ch,
  );
}

const DATA_OK =
  /^data:(?:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)|font\/[a-z0-9.+-]+|application\/(?:x-)?font-[a-z0-9.+-]+|application\/(?:vnd\.ms-fontobject|octet-stream))\s*[;,]/i;

function checkValue(value, where, errors) {
  const v = decodeCssEscapes(value).toLowerCase();
  for (const m of v.matchAll(/(?<![a-z0-9_-])(url|src)\(\s*(['"]?)\s*([^'")\s]*)/g)) {
    const target = m[3];
    if (!target.startsWith("data:"))
      errors.push(`${where}: \`${m[1]}(${target.slice(0, 60)}${target.length > 60 ? "…" : ""})\` loads a file. Fonts and images must be embedded as data: URIs (or left out).`);
    else if (!DATA_OK.test(target)) errors.push(`${where}: a data: URI of type "${target.slice(5, 40).split(/[;,]/)[0]}" isn't allowed; only images and fonts are.`);
  }
  if (/image-set\(/.test(v)) {
    for (const m of v.matchAll(/(['"])([^'"]*)\1/g))
      if (!m[2].startsWith("data:")) errors.push(`${where}: image-set() names a file ("${m[2].slice(0, 60)}"); embed it as a data: URI.`);
  }
  if (/expression\s*\(/.test(v)) errors.push(`${where}: \`expression()\` is not allowed.`);
  if (/javascript\s*:|vbscript\s*:/.test(v)) errors.push(`${where}: script URLs are not allowed.`);
}

/**
 * Parses and checks a theme stylesheet.
 * @returns {{ ok: boolean, errors: string[], rules: number }}
 */
export function validateCss(css) {
  const errors = [];
  const bytes = Buffer.byteLength(css, "utf8");
  if (bytes > LIMITS.cssBytes) {
    errors.push(`The CSS is ${Math.ceil(bytes / 1024)} KB; the limit is ${LIMITS.cssBytes / 1024} KB. Embedded fonts are usually what makes it big: subset them, or leave them out.`);
    return { ok: false, errors, rules: 0 };
  }
  let root;
  try {
    root = postcss.parse(css);
  } catch (err) {
    const where = err.line ? ` (line ${err.line}${err.column ? `, column ${err.column}` : ""})` : "";
    errors.push(`The CSS doesn't parse${where}: ${err.reason ?? err.message}.`);
    return { ok: false, errors, rules: 0 };
  }
  let rules = 0;
  root.walk((node) => {
    const at = node.source?.start?.line ? `line ${node.source.start.line}` : "CSS";
    if (node.type === "atrule") {
      const name = decodeCssEscapes(node.name).toLowerCase();
      if (name === "import") errors.push(`${at}: \`@import\` is not allowed. Paste the imported stylesheet into the theme instead.`);
      checkValue(node.params ?? "", at, errors);
    } else if (node.type === "rule") {
      rules++;
      checkValue(node.selector, at, errors);
    } else if (node.type === "decl") {
      const prop = decodeCssEscapes(node.prop).toLowerCase();
      if (/^(-[a-z]+-)?behavior$/.test(prop)) errors.push(`${at}: \`behavior\` is not allowed.`);
      if (prop === "-moz-binding") errors.push(`${at}: \`-moz-binding\` is not allowed.`);
      checkValue(node.raws.value?.raw ?? node.value, at, errors);
      if (node.raws.value?.raw) checkValue(node.value, at, errors);
    }
  });
  if (rules === 0 && !errors.length) errors.push("The CSS has no rules: it wouldn't change anything.");
  const unique = [...new Set(errors)];
  return { ok: unique.length === 0, errors: unique.slice(0, 12), rules };
}

/** The image format from a file's first bytes: "png", "jpg", "webp" or null. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Keeps a theme's name and links from closing the comment we put on top. */
export const commentSafe = (s) => String(s).replace(/\*\//g, "* /");

/** The stylesheet as published: a short header, then the author's CSS. */
export function withHeader(css, { name, author, license, source }) {
  const lines = [`${commentSafe(name)} - a Textus theme by @${commentSafe(author)}`, `License: ${license}`];
  if (source) lines.push(`Source: ${commentSafe(source)}`);
  return `/*! ${lines.join("\n *  ")}\n */\n\n${css.replace(/^﻿/, "").trim()}\n`;
}
