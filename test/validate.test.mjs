import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCssEscapes, normalizeLicense, slugify, sniffImage, validateCss, validateFields, withHeader } from "../scripts/lib/validate.mjs";

const ok = (css) => {
  const r = validateCss(css);
  assert.deepEqual(r.errors, [], css);
  assert.equal(r.ok, true);
};
const bad = (css, pattern) => {
  const r = validateCss(css);
  assert.equal(r.ok, false, `expected a rejection: ${css}`);
  assert.ok(r.errors.some((e) => pattern.test(e)), `${r.errors.join(" | ")} !~ ${pattern}`);
};

test("an ordinary theme passes", () => {
  ok(`:root { --editor-bg: #faf6ee; --editor-font: Georgia, "Songti SC", serif; }
#write h2 { border-bottom: 1px solid var(--editor-border); }
@media (max-width: 600px) { #write { padding: 0 1em; } }
@font-face { font-family: X; src: url("data:font/woff2;base64,d09GMgABAAAA") format("woff2"); }
#write blockquote { background: url(data:image/png;base64,iVBORw0KGgo=) no-repeat; }
#write hr { background-image: url( 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>' ); }
/* url(https://example.com) in a comment is fine */`);
});

test("@import is rejected, whatever it imports", () => {
  bad(`@import url("https://fonts.googleapis.com/css2?family=Inter");`, /@import/);
  bad(`@import "base.css";\n#write{}`, /@import/);
  bad(`@IMPORT 'x.css'; a{}`, /@import/);
  // An escaped name is refused too (postcss can't read it, so it doesn't parse).
  bad(`@\\69mport 'x.css'; a{}`, /@import|doesn't parse/);
});

test("url() must be a data: URI of an image or font", () => {
  bad(`a { background: url(https://example.com/x.png); }`, /loads a file/);
  bad(`a { background: url("//example.com/x.png"); }`, /loads a file/);
  bad(`a { background: url(images/x.png); }`, /loads a file/);
  bad(`@font-face { font-family: X; src: url(font.woff2); }`, /loads a file/);
  bad(`a { background: \\75 rl(https://example.com/x.png); }`, /loads a file/);
  bad(`a { background: URL(https://example.com/x.png); }`, /loads a file/);
  bad(`a { background: src("https://example.com/x.png"); }`, /loads a file/);
  bad(`a { background: image-set("x.png" 1x, "x2.png" 2x); }`, /image-set/);
  bad(`a { background: url("data:text/html;base64,PHNjcmlwdD4="); }`, /data: URI of type "text\/html"/);
});

test("old script hooks are rejected", () => {
  bad(`a { width: expression(alert(1)); }`, /expression/);
  bad(`a { background: url(javascript:alert(1)); }`, /loads a file|script/);
  bad(`a { x: "javascript:alert(1)"; }`, /script URLs/);
  bad(`a { behavior: url(x.htc); }`, /behavior/);
  bad(`a { -ms-behavior: url(x.htc); }`, /behavior/);
  bad(`a { -moz-binding: url(x.xml#y); }`, /-moz-binding/);
});

test("broken CSS, empty CSS and huge CSS", () => {
  bad(`#write { color: red;`, /doesn't parse \(line 1/);
  bad(`a { content: "unterminated; }`, /doesn't parse/);
  bad(`/* only a comment */`, /no rules/);
  bad(`a{}` + `/*${"x".repeat(200 * 1024)}*/`, /limit is 200 KB/);
});

test("escapes decode", () => {
  assert.equal(decodeCssEscapes("\\75 rl(\\\"x"), 'url("x');
});

test("licenses: SPDX ids, common spellings, blank is MIT", () => {
  assert.equal(normalizeLicense(""), "MIT");
  assert.equal(normalizeLicense(undefined), "MIT");
  assert.equal(normalizeLicense("mit"), "MIT");
  assert.equal(normalizeLicense("MIT License"), "MIT");
  assert.equal(normalizeLicense("Apache 2.0"), "Apache-2.0");
  assert.equal(normalizeLicense("GPLv3"), "GPL-3.0-only");
  assert.equal(normalizeLicense("OFL-1.1"), "OFL-1.1");
  assert.equal(normalizeLicense("CC-BY-NC-4.0"), null);
  assert.equal(normalizeLicense("all rights reserved"), null);
});

test("ids from names", () => {
  assert.equal(slugify("Inkwell"), "inkwell");
  assert.equal(slugify("  Night Owl (dark!) "), "night-owl-dark");
  assert.equal(slugify("Café Crème"), "cafe-creme");
  assert.equal(slugify("墨水"), null);
  assert.equal(slugify("A"), null);
  assert.equal(slugify("x".repeat(80)).length, 40);
});

test("fields", () => {
  assert.deepEqual(validateFields({ name: "Inkwell", description: "Quiet.", license: "" }), { fields: { name: "Inkwell", description: "Quiet.", license: "MIT" }, errors: [] });
  const r = validateFields({ name: "", description: "", license: "CC-BY-NC-4.0" });
  assert.equal(r.errors.length, 3);
  assert.match(validateFields({ name: "<b>x</b>", description: "d" }).errors[0], /can't contain/);
  assert.match(validateFields({ name: "x".repeat(61), description: "d" }).errors[0], /longer than 60/);
});

test("images by their first bytes", () => {
  const pad = (b) => Buffer.concat([b, Buffer.alloc(16)]);
  assert.equal(sniffImage(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))), "png");
  assert.equal(sniffImage(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))), "jpg");
  assert.equal(sniffImage(pad(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))), "webp");
  assert.equal(sniffImage(pad(Buffer.from("GIF89a"))), null);
  assert.equal(sniffImage(pad(Buffer.from("<svg xmlns="))), null);
});

test("the published header can't be closed early by a name", () => {
  const css = withHeader("a{}", { name: "x */ body{display:none} /*", author: "me", license: "MIT", source: "https://x" });
  ok(css);
  assert.ok(css.startsWith("/*! x * / body"));
});
