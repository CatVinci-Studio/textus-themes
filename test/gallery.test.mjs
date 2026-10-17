import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { marker, readMarker, syncIssue } from "../scripts/lib/gallery.mjs";
import { buildIndex, readThemes, writeIndex } from "../scripts/lib/catalog.mjs";

const REPO = "CatVinci-Studio/textus-themes";
const ISSUE = 1;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const IMG = (n) => `https://github.com/user-attachments/assets/00000000-0000-0000-0000-00000000000${n}`;
const ALICE = { login: "alice", id: 101, type: "User" };
const BOB = { login: "bob", id: 202, type: "User" };
const MAINTAINER = { login: "chengao", id: 1, type: "User" };
const BOT = { login: "github-actions[bot]", id: 41898282, type: "Bot" };

const submission = ({ name = "Inkwell", description = "A quiet serif theme.", license = "MIT", css = "#write { color: #222; }", images = [IMG(1)] } = {}) =>
  `\`\`\`textus-theme\nName: ${name}\nDescription: ${description}\nLicense: ${license}\n\`\`\`\n\n\`\`\`css\n${css}\n\`\`\`\n\n${images.map((u) => `![shot](${u})`).join("\n")}\n`;

/** A pretend issue: comments, the bot's replies, and the files behind URLs. */
function world({ permissions = { chengao: "admin" }, files = {} } = {}) {
  let nextId = 1000;
  let clock = 0;
  const comments = [];
  const stamp = () => `2026-10-17T10:${String(clock++).padStart(2, "0")}:00Z`;
  const w = {
    comments,
    downloads: [],
    gh: {
      async download(url, max) {
        w.downloads.push(url);
        if (url in files) return files[url].subarray(0, max + 1);
        if (url.startsWith("https://github.com/user-attachments/assets/")) return PNG;
        throw new Error("HTTP 404");
      },
      async permission(login) {
        return permissions[login] ?? "read";
      },
    },
    post(user, body) {
      const t = stamp();
      const c = { id: nextId++, user, body, created_at: t, updated_at: t, html_url: `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-${nextId - 1}` };
      comments.push(c);
      return c;
    },
    edit(c, body) {
      c.body = body;
      c.updated_at = stamp();
    },
    remove(c) {
      comments.splice(comments.indexOf(c), 1);
    },
    /** Runs a sync and applies its replies the way publish.mjs does. */
    async sync(root, opts = {}) {
      const result = await syncIssue({ root, repo: REPO, issue: ISSUE, comments: [...comments], gh: w.gh, ...opts });
      for (const r of result.replies) {
        if (r.op === "delete") comments.splice(comments.findIndex((c) => c.id === r.replyId), 1);
        else if (r.replyId) comments.find((c) => c.id === r.replyId).body = r.body;
        else w.post(BOT, r.body);
      }
      await writeIndex(root);
      return result;
    },
    replyTo(c) {
      return comments.find((x) => x.user.type === "Bot" && readMarker(x.body)?.target === c.id)?.body ?? null;
    },
  };
  return w;
}

const fresh = () => mkdtemp(join(tmpdir(), "textus-themes-"));
const meta = async (root, id) => JSON.parse(await readFile(join(root, "themes", id, "meta.json"), "utf8"));

test("publish, then nothing to do on the next run", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission());
  const r = await w.sync(root);
  assert.deepEqual(r.changes, [{ type: "publish", id: "inkwell", name: "Inkwell", author: "alice" }]);
  const m = await meta(root, "inkwell");
  assert.equal(m.author, "alice");
  assert.equal(m.comment_id, c.id);
  assert.equal(m.license, "MIT");
  assert.deepEqual(m.previews, ["preview.png"]);
  const css = await readFile(join(root, "themes/inkwell/theme.css"), "utf8");
  assert.match(css, /^\/\*! Inkwell - a Textus theme by @alice/);
  assert.match(css, /#write \{ color: #222; \}\n$/);
  assert.match(w.replyTo(c), /Published \*\*Inkwell\*\*/);
  const index = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
  assert.equal(index.themes[0].css, "themes/inkwell/theme.css");
  assert.deepEqual(index.themes[0].previews, ["themes/inkwell/preview.png"]);

  w.downloads.length = 0;
  const again = await w.sync(root);
  assert.deepEqual(again.changes, []);
  assert.deepEqual(again.replies, []);
  assert.deepEqual(w.downloads, []);
});

test("a rejected submission is answered once, then published when fixed", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission({ css: `@import url("https://fonts.googleapis.com/css2?family=Inter");\n#write{}`, images: [] }));
  const r = await w.sync(root);
  assert.deepEqual(r.changes, []);
  const reply = w.replyTo(c);
  assert.match(reply, /couldn't publish/);
  assert.match(reply, /Add a screenshot/);
  assert.ok(!existsSync(join(root, "themes/inkwell")));
  // Nothing changed: no second reply.
  assert.deepEqual((await w.sync(root)).replies, []);
  // The author fixes the screenshot only: the CSS error remains, same reply edited.
  w.edit(c, submission({ css: `@import "x.css";\n#write{}` }));
  await w.sync(root);
  assert.match(w.replyTo(c), /@import/);
  assert.equal(w.comments.filter((x) => x.user.type === "Bot").length, 1);
  // Fixed.
  w.edit(c, submission());
  const fixed = await w.sync(root);
  assert.equal(fixed.changes[0].type, "publish");
  assert.match(w.replyTo(c), /Published/);
});

test("the author updates by editing; a broken edit keeps the published version", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission({ images: [IMG(1), IMG(2)] }));
  await w.sync(root);
  assert.deepEqual((await meta(root, "inkwell")).previews, ["preview.png", "preview-2.png"]);
  const created = (await meta(root, "inkwell")).created;

  w.edit(c, submission({ name: "Inkwell Two", css: "#write { color: #111; }" }));
  const r = await w.sync(root);
  assert.deepEqual(r.changes, [{ type: "update", id: "inkwell", name: "Inkwell Two", author: "alice" }]);
  const m = await meta(root, "inkwell");
  assert.equal(m.name, "Inkwell Two");
  assert.equal(m.created, created);
  assert.deepEqual(m.previews, ["preview.png"]);
  assert.deepEqual((await readdir(join(root, "themes/inkwell"))).sort(), ["meta.json", "preview.png", "theme.css"]);
  assert.match(w.replyTo(c), /Updated/);

  w.edit(c, submission({ css: "#write { color: red;" }));
  await w.sync(root);
  assert.match(w.replyTo(c), /doesn't parse[\s\S]*published version stays up/);
  assert.match(await readFile(join(root, "themes/inkwell/theme.css"), "utf8"), /#111/);
});

test("names are first come, first served", async () => {
  const root = await fresh();
  const w = world();
  const a = w.post(ALICE, submission());
  const b = w.post(BOB, submission({ description: "Mine too." }));
  const a2 = w.post(ALICE, submission({ description: "Again." }));
  await w.sync(root);
  assert.match(w.replyTo(a), /Published/);
  assert.match(w.replyTo(b), /is taken/);
  assert.match(w.replyTo(a2), /You already published/);
  assert.equal((await readThemes(root)).length, 1);
});

test("a name with no ASCII letters still gets an id", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission({ name: "墨水" }));
  await w.sync(root);
  assert.equal((await meta(root, `theme-${c.id}`)).name, "墨水");
});

test("deleting the comment takes the theme down and clears the reply", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission());
  await w.sync(root);
  w.remove(c);
  const r = await w.sync(root);
  assert.deepEqual(r.changes.map((x) => [x.type, x.id]), [["remove", "inkwell"]]);
  assert.ok(!existsSync(join(root, "themes/inkwell")));
  assert.equal(w.comments.length, 0, "the bot's reply is deleted too");
  assert.equal(JSON.parse(await readFile(join(root, "index.json"), "utf8")).count, 0);
});

test("editing the template away takes the theme down", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission());
  await w.sync(root);
  w.edit(c, "never mind");
  const r = await w.sync(root);
  assert.equal(r.changes[0].type, "remove");
  assert.match(w.replyTo(c), /no longer has/);
});

test("/remove: strangers can't, the author and maintainers can, and it sticks", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission());
  await w.sync(root);

  const byBob = w.post(BOB, "/remove inkwell");
  await w.sync(root);
  assert.match(w.replyTo(byBob), /Only the theme's author or a maintainer/);
  assert.ok(existsSync(join(root, "themes/inkwell")));

  const missing = w.post(MAINTAINER, "/remove nothing-here");
  await w.sync(root);
  assert.match(w.replyTo(missing), /no theme `nothing-here`/);

  const byMaintainer = w.post(MAINTAINER, "/remove inkwell uses a font it may not share");
  const r = await w.sync(root);
  assert.deepEqual(r.changes.map((x) => x.type), ["remove"]);
  assert.match(w.replyTo(byMaintainer), /Removed \*\*Inkwell\*\*/);
  assert.match(w.replyTo(c), /taken down by @chengao: uses a font/);
  const removed = JSON.parse(await readFile(join(root, "removed.json"), "utf8"));
  assert.equal(removed[0].comment_id, c.id);
  assert.equal(removed[0].by, "chengao");

  // Editing the original comment doesn't bring it back.
  w.edit(c, submission({ description: "Please?" }));
  const after = await w.sync(root);
  assert.deepEqual(after.changes, []);
  assert.ok(!existsSync(join(root, "themes/inkwell")));
  assert.match(w.replyTo(c), /won't be published again/);
});

test("the author can /remove their own theme", async () => {
  const root = await fresh();
  const w = world({ permissions: {} });
  w.post(ALICE, submission());
  await w.sync(root);
  w.post(ALICE, "/remove inkwell");
  assert.deepEqual((await w.sync(root)).changes.map((x) => x.type), ["remove"]);
});

test("attached CSS is downloaded; a failed download is explained", async () => {
  const root = await fresh();
  const url = "https://github.com/user-attachments/files/123/inkwell.css";
  const w = world({ files: { [url]: Buffer.from("#write { color: #333; }") } });
  const body = submission().replace(/```css[\s\S]*?```/, `[inkwell.css](${url})`);
  w.post(ALICE, body);
  await w.sync(root);
  assert.match(await readFile(join(root, "themes/inkwell/theme.css"), "utf8"), /#333/);

  const c = w.post(BOB, submission({ name: "Other" }).replace(/```css[\s\S]*?```/, "[o.css](https://github.com/user-attachments/files/9/o.css)"));
  await w.sync(root);
  assert.match(w.replyTo(c), /Couldn't download the attached CSS/);
});

test("images that aren't PNG, JPEG or WebP, or are too big, are refused", async () => {
  const root = await fresh();
  const gif = IMG(7);
  const big = IMG(8);
  const w = world({ files: { [gif]: Buffer.from("GIF89a" + "\0".repeat(20)), [big]: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]) } });
  const c = w.post(ALICE, submission({ images: [gif, big] }));
  await w.sync(root);
  assert.match(w.replyTo(c), /Screenshot 1 isn't a PNG/);
  assert.match(w.replyTo(c), /Screenshot 2 is over 2 MB/);
  const d = w.post(BOB, submission({ name: "Three", images: [IMG(1), IMG(2), IMG(3)] }));
  await w.sync(root);
  assert.match(w.replyTo(d), /at most 2 screenshots/);
});

test("discussion and the bot's own comments are left alone", async () => {
  const root = await fresh();
  const w = world();
  w.post(BOB, "How do I make a dark theme?");
  w.post(BOT, "unrelated bot comment");
  const r = await w.sync(root);
  assert.deepEqual(r, { changes: [], replies: [] });
});

test("only so many submissions per run; the rest wait", async () => {
  const root = await fresh();
  const w = world();
  for (const n of ["One", "Two", "Three"]) w.post(ALICE, submission({ name: n }));
  assert.equal((await w.sync(root, { maxEvaluations: 2 })).changes.length, 2);
  assert.equal((await w.sync(root, { maxEvaluations: 2 })).changes.length, 1);
});

test("themes from another gallery issue and seed themes are not touched", async () => {
  const root = await fresh();
  for (const [id, extra] of [["seed", { issue: null, comment_id: null }], ["elsewhere", { issue: 99, comment_id: 5 }]]) {
    await mkdir(join(root, "themes", id), { recursive: true });
    await writeFile(join(root, "themes", id, "meta.json"), JSON.stringify({ id, name: id, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", ...extra }));
  }
  const w = world();
  assert.deepEqual((await w.sync(root)).changes, []);
  assert.equal((await readThemes(root)).length, 2);
});

test("the reply marker round-trips", () => {
  assert.deepEqual(readMarker(`${marker(42, "2026-10-17T10:00:00Z")}\nhello`), { target: 42, version: "2026-10-17T10:00:00Z" });
  assert.equal(readMarker("no marker"), null);
});

test("index: newest first, stable", () => {
  const index = buildIndex([
    { id: "b", name: "B", created: "2026-01-02", updated: "2026-03-01", previews: ["preview.png"] },
    { id: "a", name: "A", created: "2026-01-05", updated: "2026-01-05", previews: [] },
    { id: "c", name: "C", created: "2026-01-02", updated: "2026-01-02" },
  ]);
  assert.deepEqual(index.themes.map((t) => t.id), ["a", "b", "c"]);
  assert.equal(index.updated, "2026-03-01");
  assert.deepEqual(index.themes[1].previews, ["themes/b/preview.png"]);
});
