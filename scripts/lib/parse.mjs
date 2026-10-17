// Reads a comment on the gallery issue: a theme submission (the template),
// a command (`/remove`, `/approve` or `/reject <id>`), or anything else (discussion,
// ignored). Pure: no network, no files.

/** The fenced block that marks a comment as a submission. */
export const TEMPLATE_LANG = "textus-theme";

const FIELD_KEYS = ["name", "description", "license"];

// Where GitHub puts what is dragged into a comment. Files keep their name in
// the URL; images get an opaque id (older comments used the other hosts).
const FILE_URL = /https:\/\/github\.com\/user-attachments\/files\/\d+\/[^\s)"'<>\]]+/g;
const IMAGE_URL =
  /https:\/\/(?:github\.com\/user-attachments\/assets\/[0-9a-f-]{36}|(?:private-)?user-images\.githubusercontent\.com\/[^\s)"'<>\]]+)/gi;

/**
 * Splits markdown into fenced blocks and the text outside them. A fence is
 * three or more backticks or tildes; it closes on a line with at least as
 * many of the same character. An unclosed fence runs to the end, as GitHub
 * renders it.
 */
export function splitFences(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const outside = [];
  let open = null;
  for (const line of lines) {
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/.exec(line);
      if (m) {
        open = { fence: m[1], lang: m[2].toLowerCase(), lines: [] };
        continue;
      }
      outside.push(line);
    } else {
      const close = new RegExp(`^ {0,3}${open.fence[0] === "`" ? "`" : "~"}{${open.fence.length},}\\s*$`);
      if (close.test(line)) {
        blocks.push({ lang: open.lang, content: open.lines.join("\n") });
        open = null;
      } else open.lines.push(line);
    }
  }
  if (open) blocks.push({ lang: open.lang, content: open.lines.join("\n"), unclosed: true });
  return { blocks, outside: outside.join("\n") };
}

/** `Key: value` lines; a line without a known key continues the previous field. */
export function parseFields(text) {
  const fields = {};
  let last = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = /^([A-Za-z]+)\s*[:：]\s*(.*)$/.exec(line);
    if (m && FIELD_KEYS.includes(m[1].toLowerCase())) {
      last = m[1].toLowerCase();
      fields[last] = m[2].trim();
    } else if (last && line) {
      fields[last] = `${fields[last]} ${line}`.trim();
    }
  }
  return fields;
}

const unique = (list) => [...new Set(list)];

/**
 * @returns one of
 *   { kind: "none" }
 *   { kind: "command", command: "remove" | "approve" | "reject", id, reason }
 *   { kind: "theme", fields, css: { inline } | { url } | null, images, errors }
 */
export function parseComment(body) {
  const text = String(body ?? "").replace(/\r\n?/g, "\n");
  const command = /^\s*\/(remove|approve|reject)\s+([A-Za-z0-9][A-Za-z0-9-]*)[ \t]*(.*)$/i.exec(text.split("\n").find((l) => l.trim()) ?? "");
  if (command) return { kind: "command", command: command[1].toLowerCase(), id: command[2].toLowerCase(), reason: command[3].trim() };

  const { blocks, outside } = splitFences(text);
  const template = blocks.find((b) => b.lang === TEMPLATE_LANG);
  if (!template) return { kind: "none" };

  const errors = [];
  const fields = parseFields(template.content);
  // The template's placeholder block (only a comment) counts as no block.
  const cssBlocks = blocks.filter((b) => b.lang === "css" && b.content.replace(/\/\*[\s\S]*?\*\//g, "").trim());
  const files = unique(outside.match(FILE_URL) ?? []).filter((u) => /\.(css|txt)$/i.test(u));
  let css = null;
  if (cssBlocks.length > 1) errors.push("Put the whole theme in one ```css block (found " + cssBlocks.length + ").");
  else if (cssBlocks.length === 1 && files.length) errors.push("Give the CSS once: either a ```css block or an attached .css file, not both.");
  else if (files.length > 1) errors.push("Attach one .css file (found " + files.length + ").");
  else if (cssBlocks.length === 1) {
    if (cssBlocks[0].unclosed) errors.push("The ```css block is not closed: end it with a line of three backticks.");
    css = { inline: cssBlocks[0].content };
  } else if (files.length === 1) css = { url: files[0] };
  else errors.push("No CSS found: paste it in a ```css block, or drag your .css file into the comment.");

  const images = unique(outside.match(IMAGE_URL) ?? []);
  return { kind: "theme", fields, css, images, errors };
}
