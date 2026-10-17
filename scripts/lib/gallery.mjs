// Brings themes/ and pending/ in line with the comments on one gallery issue.
//
// Nothing goes live without a person looking at it:
//
//   - a submission (a comment with the template) whose current version
//     hasn't been looked at yet is checked automatically; if it passes it
//     goes to pending/<id>/ and the maintainers are mentioned, if not the
//     author is told what to fix;
//   - `/approve <id>` from someone with write access moves exactly the
//     pending version into themes/<id>/, the published catalog;
//     `/reject <id> <reason>` drops it and tells the author why;
//   - an edit after approval is checked and queued again; the approved
//     version stays live until the new one is approved;
//   - `/remove <id>` (author or maintainer) takes a theme down for good
//     (removed.json); deleting the comment, or editing the template away,
//     takes down its published and pending versions.
//
// The issue's comments are the source of truth. Every run looks at all of
// them, not just the one that triggered it, so a run GitHub drops (a burst
// of comments queues at most one pending run) is caught up by the next.
// They are taken in time order - a submission at the time of its latest
// edit, a command when it was posted - so `/approve` always approves the
// version that was waiting when the maintainer wrote it, even when the
// author edited again before this run.
//
// "Looked at" is remembered in the bot's own reply to each comment, which
// carries a hidden marker with the comment id and the version (updated_at)
// it answered.
//
// File writes happen here; git and the replies themselves are left to the
// caller (scripts/publish.mjs), which posts replies only after the push.
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { parseComment } from "./parse.mjs";
import { LIMITS, sniffImage, slugify, validateCss, validateFields, withHeader } from "./validate.mjs";
import { readThemes } from "./catalog.mjs";

export const GALLERY_URL = "https://textus.catvinci.com/themes/";
/** Mentioned when a theme starts waiting for review. */
export const MAINTAINERS = ["ChengAoShen", "jzzzzh"];
const WRITE_ROLES = new Set(["admin", "maintain", "write"]);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const marker = (target, version) => `<!-- textus-themes reply-to=${target} version=${version} -->`;
export function readMarker(body) {
  const m = /<!-- textus-themes reply-to=(\d+) version=(\S+) -->/.exec(String(body ?? ""));
  return m ? { target: Number(m[1]), version: m[2] } : null;
}

async function readRemoved(root) {
  try {
    return JSON.parse(await readFile(join(root, "removed.json"), "utf8"));
  } catch {
    return [];
  }
}

function dirOf(root, folder, id) {
  if (!ID_RE.test(id)) throw new Error(`refusing theme id ${JSON.stringify(id)}`);
  const base = resolve(root, folder);
  const dir = resolve(base, id);
  if (!dir.startsWith(base + sep)) throw new Error(`refusing path for ${id}`);
  return dir;
}

const bullet = (errors) => errors.map((e) => `- ${e}`).join("\n");

/**
 * @param {object} o
 * @param {string} o.root        repository checkout
 * @param {string} o.repo        "owner/name"
 * @param {number} o.issue       gallery issue number
 * @param {object[]} o.comments  every comment on the issue (GitHub REST shape)
 * @param {object} o.gh          { download(url, maxBytes) -> Buffer, permission(login) -> string }
 * @param {string} [o.botLogin]
 * @param {string[]} [o.maintainers]   mentioned when something starts waiting for review
 * @param {number} [o.maxEvaluations]  comments acted on per run; the rest wait for the next
 * @returns {{ changes: object[], replies: object[] }}
 *   replies: { op: "upsert", target, replyId?, body, fresh? } | { op: "delete", replyId }
 *   (`fresh`: post a new reply instead of editing the old one, so its mentions notify)
 */
export async function syncIssue({ root, repo, issue, comments, gh, botLogin = "github-actions[bot]", maintainers = MAINTAINERS, maxEvaluations = 15 }) {
  const changes = [];
  const replies = [];
  const published = await readThemes(root, "themes");
  const pending = await readThemes(root, "pending");
  const removed = await readRemoved(root);
  let removedDirty = false;
  const isBot = (c) => c.user?.type === "Bot" || c.user?.login === botLogin;
  const treeUrl = (folder, id) => `https://github.com/${repo}/tree/main/${folder}/${id}`;
  const permissions = new Map();
  const canWrite = async (login) => {
    if (!permissions.has(login)) permissions.set(login, WRITE_ROLES.has(await gh.permission(login).catch(() => "none")));
    return permissions.get(login);
  };

  const answered = new Map(); // comment id -> { replyId, version }
  for (const c of comments) {
    if (!isBot(c)) continue;
    const m = readMarker(c.body);
    if (m) answered.set(m.target, { replyId: c.id, version: m.version });
  }
  const versionOf = (c) => c.updated_at ?? c.created_at;
  const live = comments.filter((c) => !isBot(c));
  const liveIds = new Set(live.map((c) => c.id));
  const kinds = new Map(live.map((c) => [c.id, parseComment(c.body)]));
  const when = (c) => (kinds.get(c.id).kind === "command" ? c.created_at : versionOf(c));
  live.sort((a, b) => String(when(a)).localeCompare(String(when(b))) || a.id - b.id);

  const reply = (c, version, body, { fresh = false } = {}) => {
    replies.push({ op: "upsert", target: c.id, replyId: answered.get(c.id)?.replyId, body: `${marker(c.id, version)}\n${body}`, fresh });
    answered.set(c.id, { replyId: answered.get(c.id)?.replyId, version });
  };
  const ofComment = (list, c) => list.find((m) => m.issue === issue && m.comment_id === c.id);
  const drop = async (list, folder, meta, type, why) => {
    await rm(dirOf(root, folder, meta.id), { recursive: true, force: true });
    list.splice(list.indexOf(meta), 1);
    changes.push({ type, id: meta.id, name: meta.name, author: meta.author, why });
  };
  const takeDown = async (meta, why) => drop(published, "themes", meta, "remove", why);
  const unqueue = async (meta, why) => drop(pending, "pending", meta, "unqueue", why);

  // Themes whose comment was deleted, and replies left without a comment.
  for (const [list, folder] of [[published, "themes"], [pending, "pending"]]) {
    for (const meta of [...list]) {
      if (meta.issue === issue && meta.comment_id && !liveIds.has(meta.comment_id))
        await drop(list, folder, meta, folder === "themes" ? "remove" : "unqueue", "comment deleted");
    }
  }
  for (const [target, a] of answered) {
    if (!liveIds.has(target)) replies.push({ op: "delete", replyId: a.replyId });
  }

  let evaluations = 0;
  for (const c of live) {
    const version = versionOf(c);
    const parsed = kinds.get(c.id);
    const live_ = ofComment(published, c);
    const queued = ofComment(pending, c);
    const done = answered.get(c.id)?.version === version;

    if (parsed.kind === "none") {
      if (live_ || queued) {
        const name = (live_ ?? queued).name;
        if (live_) await takeDown(live_, "template removed");
        if (queued) await unqueue(queued, "template removed");
        reply(c, version, `Removed **${name}**: this comment no longer has the \`textus-theme\` block. Put it back to submit the theme again.`);
      } else if (answered.get(c.id)?.replyId) {
        replies.push({ op: "delete", replyId: answered.get(c.id).replyId });
        answered.delete(c.id);
      }
      continue;
    }
    if (done) continue;

    if (parsed.kind === "theme") {
      if (removed.some((r) => r.comment_id === c.id)) {
        reply(c, version, `This theme was taken down with \`/remove\` and won't be published again from this comment. Ask a maintainer if you think that was a mistake.`);
        continue;
      }
      // Already handled, but the reply didn't make it (a failed run): just answer.
      if (queued && queued.source_updated === version) {
        reply(c, version, pendingText(c, queued, Boolean(live_)), { fresh: true });
        continue;
      }
      if (live_ && live_.source_updated === version) {
        reply(c, version, approvedText(c, live_, live_.approved_by));
        continue;
      }
    }
    if (evaluations >= maxEvaluations) continue;
    evaluations++;

    if (parsed.kind === "command") {
      if (parsed.command === "remove") await runRemove(c, parsed, version);
      else await runReview(c, parsed, version);
      continue;
    }
    await runSubmission(c, parsed, version, live_, queued);
  }

  function pendingText(c, meta, isLive) {
    return `@${c.user.login} **${meta.name}** passed the automatic checks and is waiting for a maintainer's review ([\`pending/${meta.id}\`](${treeUrl("pending", meta.id)})). It goes live on ${GALLERY_URL} once it is approved.${isLive ? " The version that is live now stays up until then." : ""}

${maintainers.map((m) => `@${m}`).join(" ")}: reply \`/approve ${meta.id}\` to publish it, or \`/reject ${meta.id} <reason>\` to turn it down.`;
  }

  function approvedText(c, meta, by) {
    return `@${c.user.login} **${meta.name}** was approved${by ? ` by @${by}` : ""} and is published as [\`${meta.id}\`](${treeUrl("themes", meta.id)}). It shows on ${GALLERY_URL} within a few minutes.

Edit this comment to update the theme (each new version is reviewed again); delete the comment to take it down.`;
  }

  async function runReview(c, parsed, version) {
    const login = c.user.login;
    if (!(await canWrite(login))) return reply(c, version, `@${login} Only maintainers can approve or reject themes.`);
    const entry = pending.find((m) => m.id === parsed.id);
    if (!entry) return reply(c, version, `@${login} There is no theme waiting for review as \`${parsed.id}\`.`);
    const source = entry.comment_id && live.find((x) => x.id === entry.comment_id);
    const current = published.find((m) => m.id === entry.id);

    if (parsed.command === "reject") {
      await unqueue(entry, `/reject by @${login}`);
      changes[changes.length - 1].type = "reject";
      reply(c, version, `Rejected \`${entry.id}\`.`);
      if (source)
        reply(source, entry.source_updated, `@${source.user.login} A maintainer (@${login}) didn't accept this version of **${entry.name}**${parsed.reason ? `: ${parsed.reason.replace(/[.!?。！？]*$/, ".")}` : "."}${current ? " The published version stays up." : ""}

Edit your comment to submit a new version.`);
      return;
    }

    // Approve: exactly the pending snapshot becomes the published theme.
    const next = { ...entry, created: current?.created ?? entry.created, approved_by: login, approved_at: c.created_at };
    const from = dirOf(root, "pending", entry.id);
    const to = dirOf(root, "themes", entry.id);
    await rm(to, { recursive: true, force: true });
    await mkdir(resolve(to, ".."), { recursive: true });
    await rename(from, to);
    await writeFile(join(to, "meta.json"), `${JSON.stringify(next, null, 2)}\n`);
    pending.splice(pending.indexOf(entry), 1);
    if (current) published.splice(published.indexOf(current), 1, next);
    else published.push(next);
    changes.push({ type: current ? "update" : "publish", id: next.id, name: next.name, author: next.author, why: `approved by @${login}` });
    reply(c, version, `Approved and published **${next.name}** ([\`${next.id}\`](${treeUrl("themes", next.id)})).`);
    if (source) reply(source, entry.source_updated, approvedText(source, next, login));
  }

  async function runRemove(c, parsed, version) {
    const target = published.find((m) => m.id === parsed.id) ?? pending.find((m) => m.id === parsed.id);
    if (!target) return reply(c, version, `@${c.user.login} There is no theme \`${parsed.id}\`.`);
    const allowed = (target.author_id != null && target.author_id === c.user.id) || (await canWrite(c.user.login));
    if (!allowed) return reply(c, version, `@${c.user.login} Only the theme's author or a maintainer can remove \`${parsed.id}\`.`);
    const why = `/remove by @${c.user.login}`;
    for (const [list, fn] of [[published, takeDown], [pending, unqueue]]) {
      const m = list.find((x) => x.id === parsed.id);
      if (m) await fn(m, why);
    }
    removed.push({ id: target.id, name: target.name, author: target.author, issue: target.issue ?? null, comment_id: target.comment_id ?? null, by: c.user.login, at: c.created_at, reason: parsed.reason || null });
    removedDirty = true;
    reply(c, version, `Removed **${target.name}** (\`${target.id}\`). It comes off ${GALLERY_URL} within a few minutes.`);
    const source = target.comment_id && live.find((x) => x.id === target.comment_id);
    if (source) reply(source, versionOf(source), `This theme was taken down by @${c.user.login}${parsed.reason ? `: ${parsed.reason}` : "."}`);
  }

  async function runSubmission(c, parsed, version, current, queued) {
    const login = c.user.login;
    const stays = current ? `\n\nThe published version stays up until a new one is approved.` : "";
    const reject = (errors) =>
      reply(c, version, `@${login} I couldn't accept this theme yet:\n\n${bullet(errors)}\n\nEdit your comment to fix it; it is checked again when you save.${stays}`);

    const errors = [...parsed.errors];
    const { fields, errors: fieldErrors } = validateFields(parsed.fields);
    errors.push(...fieldErrors);
    if (parsed.images.length === 0) errors.push("Add a screenshot of the theme (drag an image into the comment): it is the theme's picture in the gallery.");
    if (parsed.images.length > LIMITS.images) errors.push(`Use at most ${LIMITS.images} screenshots (found ${parsed.images.length}).`);

    let id = current?.id ?? queued?.id;
    if (!id && fields.name) {
      id = slugify(fields.name) ?? `theme-${c.id}`;
      const owner = published.find((m) => m.id === id) ?? pending.find((m) => m.id === id);
      if (owner && owner.author_id === c.user.id && owner.comment_id)
        errors.push(`You already submitted **${owner.name}** as \`${id}\` from ${owner.source}. Edit that comment to update it, or pick another name.`);
      else if (owner) errors.push(`The name "${fields.name}" is taken (\`${id}\`, by @${owner.author}). Pick another name.`);
    }
    if (errors.length) return reject(errors);

    let css = parsed.css.inline;
    if (css === undefined) {
      try {
        const buf = await gh.download(parsed.css.url, LIMITS.cssBytes + 1);
        if (buf.length > LIMITS.cssBytes) return reject([`The attached CSS is over ${LIMITS.cssBytes / 1024} KB.`]);
        css = buf.toString("utf8");
      } catch (err) {
        return reject([`Couldn't download the attached CSS (${err.message}). Try attaching it again, or paste it in a \`\`\`css block.`]);
      }
    }
    errors.push(...validateCss(css).errors);

    const images = [];
    for (const [i, url] of parsed.images.slice(0, LIMITS.images).entries()) {
      const n = i + 1;
      let buf;
      try {
        buf = await gh.download(url, LIMITS.imageBytes + 1);
      } catch (err) {
        errors.push(`Couldn't download screenshot ${n} (${err.message}).`);
        continue;
      }
      if (buf.length > LIMITS.imageBytes) {
        errors.push(`Screenshot ${n} is over ${LIMITS.imageBytes / 1024 / 1024} MB.`);
        continue;
      }
      const ext = sniffImage(buf);
      if (!ext) errors.push(`Screenshot ${n} isn't a PNG, JPEG or WebP image.`);
      else images.push({ buf, file: `${n === 1 ? "preview" : `preview-${n}`}.${ext}` });
    }
    if (errors.length) return reject(errors);

    // Passed: the snapshot a maintainer reviews, in pending/<id>/.
    const dir = dirOf(root, "pending", id);
    await mkdir(dir, { recursive: true });
    const next = {
      id,
      name: fields.name,
      author: login,
      author_id: c.user.id,
      description: fields.description,
      license: fields.license,
      issue,
      comment_id: c.id,
      source: c.html_url,
      created: current?.created ?? c.created_at,
      updated: version,
      source_updated: version,
      css: "theme.css",
      previews: images.map((im) => im.file),
    };
    await writeFile(join(dir, "theme.css"), withHeader(css, { name: next.name, author: login, license: next.license, source: next.source }));
    for (const im of images) await writeFile(join(dir, im.file), im.buf);
    const wanted = new Set(["theme.css", "meta.json", ...next.previews]);
    for (const f of await readdir(dir)) if (!wanted.has(f)) await unlink(join(dir, f));
    await writeFile(join(dir, "meta.json"), `${JSON.stringify(next, null, 2)}\n`);
    if (queued) pending.splice(pending.indexOf(queued), 1, next);
    else pending.push(next);
    changes.push({ type: "pending", id, name: next.name, author: login });
    reply(c, version, pendingText(c, next, Boolean(current)), { fresh: true });
  }

  if (removedDirty) await writeFile(join(root, "removed.json"), `${JSON.stringify(removed, null, 2)}\n`);
  // One reply per comment: a later answer in the same run replaces an earlier one.
  const last = new Map();
  replies.forEach((r, i) => r.op === "upsert" && last.set(r.target, i));
  return { changes, replies: replies.filter((r, i) => r.op !== "upsert" || last.get(r.target) === i) };
}
