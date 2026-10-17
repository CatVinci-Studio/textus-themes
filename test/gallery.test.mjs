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
    created: 0,
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
      const result = await syncIssue({ root, repo: REPO, issue: ISSUE, comments: [...comments], gh: w.gh, maintainers: ["chengao", "jz"], ...opts });
      for (const r of result.replies) {
        const drop = (id) => comments.splice(comments.findIndex((c) => c.id === id), 1);
        if (r.op === "delete") drop(r.replyId);
        else if (r.replyId && !r.fresh) comments.find((c) => c.id === r.replyId).body = r.body;
        else {
          if (r.replyId) drop(r.replyId);
          w.created++;
          w.post(BOT, r.body);
        }
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
const meta = async (root, id, folder = "themes") => JSON.parse(await readFile(join(root, folder, id, "meta.json"), "utf8"));
const css = (root, id, folder = "themes") => readFile(join(root, folder, id, "theme.css"), "utf8");
const index = async (root) => JSON.parse(await readFile(join(root, "index.json"), "utf8"));
const types = (r) => r.changes.map((x) => x.type);

/** Posts a submission, syncs, approves it and syncs again. */
async function publish(w, root, user = ALICE, opts = {}) {
  const c = w.post(user, submission(opts));
  await w.sync(root);
  w.post(MAINTAINER, `/approve ${opts.id ?? "inkwell"}`);
  await w.sync(root);
  return c;
}

test("a submission that passes waits for review, mentions the maintainers once, and stays out of the index", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission());
  const r = await w.sync(root);
  assert.deepEqual(r.changes, [{ type: "pending", id: "inkwell", name: "Inkwell", author: "alice" }]);
  assert.ok(existsSync(join(root, "pending/inkwell/theme.css")));
  assert.ok(!existsSync(join(root, "themes/inkwell")));
  assert.equal((await index(root)).count, 0);
  const reply = w.replyTo(c);
  assert.match(reply, /passed the automatic checks and is waiting for a maintainer's review/);
  assert.match(reply, /@chengao @jz: reply `\/approve inkwell`/);
  assert.match(await css(root, "inkwell", "pending"), /^\/\*! Inkwell - a Textus theme by @alice/);

  // Nothing new: no second reply, no second mention.
  w.downloads.length = 0;
  const again = await w.sync(root);
  assert.deepEqual(again, { changes: [], replies: [] });
  assert.deepEqual(w.downloads, []);
  assert.equal(w.created, 1);
});

test("/approve publishes exactly the reviewed version", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission({ images: [IMG(1), IMG(2)] }));
  await w.sync(root);
  const approve = w.post(MAINTAINER, "/approve inkwell");
  const r = await w.sync(root);
  assert.deepEqual(types(r), ["publish"]);
  assert.ok(!existsSync(join(root, "pending/inkwell")));
  const m = await meta(root, "inkwell");
  assert.equal(m.approved_by, "chengao");
  assert.equal(m.author, "alice");
  assert.deepEqual(m.previews, ["preview.png", "preview-2.png"]);
  assert.deepEqual((await readdir(join(root, "themes/inkwell"))).sort(), ["meta.json", "preview-2.png", "preview.png", "theme.css"]);
  assert.match(w.replyTo(approve), /Approved and published \*\*Inkwell\*\*/);
  assert.match(w.replyTo(c), /was approved by @chengao and is published as \[`inkwell`\]/);
  const idx = await index(root);
  assert.deepEqual(idx.themes.map((t) => t.id), ["inkwell"]);
  assert.equal(idx.themes[0].css, "themes/inkwell/theme.css");
  // Settled: nothing more to do.
  assert.deepEqual(await w.sync(root), { changes: [], replies: [] });
});

test("an edit after approval goes back to review while the approved version stays live", async () => {
  const root = await fresh();
  const w = world();
  const c = await publish(w, root);
  const created = (await meta(root, "inkwell")).created;

  w.edit(c, submission({ name: "Inkwell Two", css: "#write { color: #111; }" }));
  const r = await w.sync(root);
  assert.deepEqual(types(r), ["pending"]);
  assert.match(await css(root, "inkwell"), /#222/, "the approved version is still live");
  assert.match(await css(root, "inkwell", "pending"), /#111/);
  assert.equal((await index(root)).themes[0].name, "Inkwell");
  assert.match(w.replyTo(c), /waiting for a maintainer's review.*The version that is live now stays up/s);

  w.post(MAINTAINER, "/approve inkwell");
  const approved = await w.sync(root);
  assert.deepEqual(types(approved), ["update"]);
  const m = await meta(root, "inkwell");
  assert.equal(m.name, "Inkwell Two");
  assert.equal(m.created, created);
  assert.match(await css(root, "inkwell"), /#111/);
});

test("/approve takes the version waiting when it was written, not a later edit", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission({ css: "#write { color: #101010; }" }));
  await w.sync(root);
  // The maintainer approves, then the author edits before the next run.
  w.post(MAINTAINER, "/approve inkwell");
  w.edit(c, submission({ css: "#write { color: #202020; }" }));
  const r = await w.sync(root);
  assert.deepEqual(types(r), ["publish", "pending"]);
  assert.match(await css(root, "inkwell"), /#101010/);
  assert.match(await css(root, "inkwell", "pending"), /#202020/);
  assert.match(w.replyTo(c), /waiting for a maintainer's review/);
});

test("/reject drops the pending version and tells the author why", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission());
  await w.sync(root);
  const rej = w.post(MAINTAINER, "/reject inkwell the link colour is unreadable");
  const r = await w.sync(root);
  assert.deepEqual(types(r), ["reject"]);
  assert.ok(!existsSync(join(root, "pending/inkwell")));
  assert.match(w.replyTo(rej), /Rejected `inkwell`/);
  assert.match(w.replyTo(c), /A maintainer \(@chengao\) didn't accept this version of \*\*Inkwell\*\*: the link colour is unreadable\.\s+Edit your comment/);
  assert.deepEqual(await w.sync(root), { changes: [], replies: [] });
  // A new version goes back into review.
  w.edit(c, submission({ css: "#write a { color: #0645ad; }" }));
  assert.deepEqual(types(await w.sync(root)), ["pending"]);
});

test("rejecting an update keeps the published version", async () => {
  const root = await fresh();
  const w = world();
  const c = await publish(w, root);
  w.edit(c, submission({ css: "#write { color: red; }" }));
  await w.sync(root);
  w.post(MAINTAINER, "/reject inkwell");
  await w.sync(root);
  assert.match(w.replyTo(c), /didn't accept this version.*The published version stays up/s);
  assert.match(await css(root, "inkwell"), /#222/);
});

test("/approve and /reject from someone without write access change nothing", async () => {
  const root = await fresh();
  const w = world();
  w.post(ALICE, submission());
  await w.sync(root);
  const a = w.post(ALICE, "/approve inkwell");
  const b = w.post(BOB, "/reject inkwell spam");
  const r = await w.sync(root);
  assert.deepEqual(r.changes, []);
  assert.ok(existsSync(join(root, "pending/inkwell")));
  assert.ok(!existsSync(join(root, "themes/inkwell")));
  assert.match(w.replyTo(a), /Only maintainers can approve or reject/);
  assert.match(w.replyTo(b), /Only maintainers can approve or reject/);
  const none = w.post(MAINTAINER, "/approve nothing");
  await w.sync(root);
  assert.match(w.replyTo(none), /no theme waiting for review as `nothing`/);
});

test("a rejected submission is answered once, then queued when fixed", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission({ css: `@import url("https://fonts.googleapis.com/css2?family=Inter");\n#write{}`, images: [] }));
  const r = await w.sync(root);
  assert.deepEqual(r.changes, []);
  assert.match(w.replyTo(c), /couldn't accept[\s\S]*Add a screenshot/);
  assert.ok(!existsSync(join(root, "pending/inkwell")));
  assert.deepEqual((await w.sync(root)).replies, []);
  w.edit(c, submission());
  assert.deepEqual(types(await w.sync(root)), ["pending"]);
});

test("a broken edit of a published theme keeps it live", async () => {
  const root = await fresh();
  const w = world();
  const c = await publish(w, root);
  w.edit(c, submission({ css: "#write { color: red;" }));
  await w.sync(root);
  assert.match(w.replyTo(c), /doesn't parse[\s\S]*published version stays up/);
  assert.match(await css(root, "inkwell"), /#222/);
});

test("names are first come, first served, pending ones included", async () => {
  const root = await fresh();
  const w = world();
  const a = w.post(ALICE, submission());
  const b = w.post(BOB, submission({ description: "Mine too." }));
  const a2 = w.post(ALICE, submission({ description: "Again." }));
  await w.sync(root);
  assert.match(w.replyTo(a), /waiting for a maintainer's review/);
  assert.match(w.replyTo(b), /is taken/);
  assert.match(w.replyTo(a2), /You already submitted/);
  assert.equal((await readThemes(root, "pending")).length, 1);
});

test("a name with no ASCII letters still gets an id", async () => {
  const root = await fresh();
  const w = world();
  const c = w.post(ALICE, submission({ name: "墨水" }));
  await w.sync(root);
  assert.equal((await meta(root, `theme-${c.id}`, "pending")).name, "墨水");
});

test("deleting the comment takes down the published and the pending version", async () => {
  const root = await fresh();
  const w = world();
  const c = await publish(w, root);
  w.edit(c, submission({ css: "#write { color: #333; }" }));
  await w.sync(root);
  w.remove(c);
  const r = await w.sync(root);
  assert.deepEqual(types(r).sort(), ["remove", "unqueue"]);
  assert.ok(!existsSync(join(root, "themes/inkwell")));
  assert.ok(!existsSync(join(root, "pending/inkwell")));
  assert.equal(w.replyTo(c), null);
  assert.equal((await index(root)).count, 0);
});

test("editing the template away takes the theme down", async () => {
  const root = await fresh();
  const w = world();
  const c = await publish(w, root);
  w.edit(c, "never mind");
  const r = await w.sync(root);
  assert.deepEqual(types(r), ["remove"]);
  assert.match(w.replyTo(c), /no longer has/);
});

test("/remove: strangers can't, the author and maintainers can, and it sticks", async () => {
  const root = await fresh();
  const w = world();
  const c = await publish(w, root);

  const byBob = w.post(BOB, "/remove inkwell");
  await w.sync(root);
  assert.match(w.replyTo(byBob), /Only the theme's author or a maintainer/);
  assert.ok(existsSync(join(root, "themes/inkwell")));

  const byMaintainer = w.post(MAINTAINER, "/remove inkwell uses a font it may not share");
  const r = await w.sync(root);
  assert.deepEqual(types(r), ["remove"]);
  assert.match(w.replyTo(byMaintainer), /Removed \*\*Inkwell\*\*/);
  assert.match(w.replyTo(c), /taken down by @chengao: uses a font/);
  const removed = JSON.parse(await readFile(join(root, "removed.json"), "utf8"));
  assert.equal(removed[0].comment_id, c.id);

  w.edit(c, submission({ description: "Please?" }));
  const after = await w.sync(root);
  assert.deepEqual(after.changes, []);
  assert.ok(!existsSync(join(root, "pending/inkwell")));
  assert.match(w.replyTo(c), /won't be published again/);
});

test("the author can /remove their own theme, pending or published", async () => {
  const root = await fresh();
  const w = world({ permissions: { chengao: "admin" } });
  w.post(ALICE, submission());
  await w.sync(root);
  w.post(ALICE, "/remove inkwell");
  assert.deepEqual(types(await w.sync(root)), ["unqueue"]);
  assert.ok(!existsSync(join(root, "pending/inkwell")));
});

test("attached CSS is downloaded; a failed download is explained", async () => {
  const root = await fresh();
  const url = "https://github.com/user-attachments/files/123/inkwell.css";
  const w = world({ files: { [url]: Buffer.from("#write { color: #333; }") } });
  w.post(ALICE, submission().replace(/```css[\s\S]*?```/, `[inkwell.css](${url})`));
  await w.sync(root);
  assert.match(await css(root, "inkwell", "pending"), /#333/);

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
  assert.deepEqual(await w.sync(root), { changes: [], replies: [] });
});

test("only so many comments are acted on per run; the rest wait", async () => {
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
  const idx = buildIndex([
    { id: "b", name: "B", created: "2026-01-02", updated: "2026-03-01", previews: ["preview.png"] },
    { id: "a", name: "A", created: "2026-01-05", updated: "2026-01-05", previews: [] },
    { id: "c", name: "C", created: "2026-01-02", updated: "2026-01-02" },
  ]);
  assert.deepEqual(idx.themes.map((t) => t.id), ["a", "b", "c"]);
  assert.equal(idx.updated, "2026-03-01");
  assert.deepEqual(idx.themes[1].previews, ["themes/b/preview.png"]);
});
