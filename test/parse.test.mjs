import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComment, parseFields, splitFences } from "../scripts/lib/parse.mjs";

const IMG = "https://github.com/user-attachments/assets/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const IMG2 = "https://github.com/user-attachments/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const template = ({ fields = "Name: Inkwell\nDescription: A quiet serif theme.\nLicense: MIT", css = "```css\n#write { color: #222; }\n```", images = `![shot](${IMG})` } = {}) =>
  `\`\`\`textus-theme\n${fields}\n\`\`\`\n\n${css}\n\n${images}\n`;

test("reads the template, an inline CSS block and a screenshot", () => {
  const r = parseComment(template());
  assert.equal(r.kind, "theme");
  assert.deepEqual(r.fields, { name: "Inkwell", description: "A quiet serif theme.", license: "MIT" });
  assert.deepEqual(r.css, { inline: "#write { color: #222; }" });
  assert.deepEqual(r.images, [IMG]);
  assert.deepEqual(r.errors, []);
});

test("CRLF line endings and full-width colons are fine", () => {
  const r = parseComment(template({ fields: "Name：墨水\r\nDescription：安静的衬线主题\r\nLicense:" }).replace(/\n/g, "\r\n"));
  assert.equal(r.fields.name, "墨水");
  assert.equal(r.fields.description, "安静的衬线主题");
  assert.equal(r.fields.license, "");
});

test("a description can run over several lines", () => {
  assert.deepEqual(parseFields("Name: A\nDescription: one\n  two\nLicense: MIT"), { name: "A", description: "one two", license: "MIT" });
});

test("an attached .css file instead of a block", () => {
  const url = "https://github.com/user-attachments/files/17234567/inkwell.css";
  const r = parseComment(template({ css: `[inkwell.css](${url})` }));
  assert.deepEqual(r.css, { url });
  assert.deepEqual(r.errors, []);
});

test("the template's placeholder block doesn't count against an attachment", () => {
  const url = "https://github.com/user-attachments/files/1/a.css";
  const r = parseComment(template({ css: "```css\n/* Paste your whole theme here. */\n```\n" + `[a.css](${url})` }));
  assert.deepEqual(r.css, { url });
  assert.deepEqual(r.errors, []);
  assert.match(parseComment(template({ css: "```css\n/* Paste your whole theme here. */\n```" })).errors[0], /No CSS found/);
});

test("an attached .txt works too (for when GitHub refuses .css)", () => {
  const url = "https://github.com/user-attachments/files/1/inkwell.css.txt";
  assert.deepEqual(parseComment(template({ css: `[f](${url})` })).css, { url });
});

test("both a block and a file, two blocks, or none are errors", () => {
  const url = "https://github.com/user-attachments/files/1/a.css";
  assert.match(parseComment(template({ css: "```css\na{}\n```\n" + `[a.css](${url})` })).errors[0], /either/);
  assert.match(parseComment(template({ css: "```css\na{}\n```\n```css\nb{}\n```" })).errors[0], /one ```css block/);
  assert.match(parseComment(template({ css: "" })).errors[0], /No CSS found/);
});

test("an unclosed css block is reported", () => {
  const r = parseComment("```textus-theme\nName: A\n```\n```css\na { color: red; }\n");
  assert.match(r.errors[0], /not closed/);
});

test("images: markdown, <img> tags, duplicates once, and not from inside the CSS", () => {
  const body = template({
    css: `\`\`\`css\n/* ${IMG2} */ a{}\n\`\`\``,
    images: `![a](${IMG})\n<img width="1280" alt="b" src="${IMG}" />\n<img src="${IMG2}">`,
  });
  assert.deepEqual(parseComment(body).images, [IMG, IMG2]);
});

test("a comment without the template is discussion", () => {
  assert.equal(parseComment("Love this gallery! ```css\na{}\n```").kind, "none");
  assert.equal(parseComment("").kind, "none");
  assert.equal(parseComment(null).kind, "none");
});

test("/remove commands", () => {
  assert.deepEqual(parseComment("/remove Inkwell-Dark  copies another theme"), { kind: "command", command: "remove", id: "inkwell-dark", reason: "copies another theme" });
  assert.deepEqual(parseComment("\n\n/remove lumen\n"), { kind: "command", command: "remove", id: "lumen", reason: "" });
  assert.equal(parseComment("please /remove lumen").kind, "none");
});

test("fences: tildes and longer fences nest shorter ones", () => {
  const { blocks } = splitFences("````markdown\n```css\na{}\n```\n````\n~~~css\nb{}\n~~~");
  assert.deepEqual(blocks.map((b) => b.lang), ["markdown", "css"]);
  assert.equal(blocks[1].content, "b{}");
});
