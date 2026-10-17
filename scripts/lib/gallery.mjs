// Brings the themes/ folder in line with the comments on one gallery issue.
//
// The issue's comments are the source of truth. Every run looks at all of
// them, not just the one that triggered it, so a run GitHub drops (a burst
// of comments queues at most one pending run) is caught up by the next:
//
//   - a comment with the template whose current version hasn't been looked
//     at yet is validated, and published or answered with what to fix;
//   - a `/remove <id>` comment not yet answered is carried out if its
//     author owns the theme or can write to the repository;
//   - a theme whose comment is gone (deleted), or no longer has the
//     template, is removed;
//   - removed.json lists themes taken down with /remove; their comments are
//     not published again.
//
// "Looked at" is remembered in the bot's own reply to each comment, which
// carries a hidden marker with the comment id and the version (updated_at)
// it answered. Nothing is written for a rejected submission but that reply.
//
// File writes happen here; git and the replies themselves are left to the
// caller (scripts/publish.mjs), which posts replies only after the push.
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { parseComment } from "./parse.mjs";
import { LIMITS, sniffImage, slugify, validateCss, validateFields, withHeader } from "./validate.mjs";
import { readThemes } from "./catalog.mjs";

export const GALLERY_URL = "https://textus.catvinci.com/themes/";
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

function themeDir(root, id) {
  if (!ID_RE.test(id)) throw new Error(`refusing theme id ${JSON.stringify(id)}`);
  const base = resolve(root, "themes");
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
 * @param {number} [o.maxEvaluations]  submissions validated per run; the rest wait for the next
 * @returns {{ changes: object[], replies: object[] }}
 *   replies: { op: "upsert", target, replyId?, body } | { op: "delete", replyId }
 */
export async function syncIssue({ root, repo, issue, comments, gh, botLogin = "github-actions[bot]", maxEvaluations = 15 }) {
  const changes = [];
  const replies = [];
  const metas = await readThemes(root);
  const removed = await readRemoved(root);
  let removedDirty = false;
  const isBot = (c) => c.user?.type === "Bot" || c.user?.login === botLogin;
  const treeUrl = (id) => `https://github.com/${repo}/tree/main/themes/${id}`;

  const answered = new Map(); // comment id -> { replyId, version }
  for (const c of comments) {
    if (!isBot(c)) continue;
    const m = readMarker(c.body);
    if (m) answered.set(m.target, { replyId: c.id, version: m.version });
  }
  const live = comments.filter((c) => !isBot(c)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
  const liveIds = new Set(live.map((c) => c.id));

  const reply = (c, version, body) => {
    replies.push({ op: "upsert", target: c.id, replyId: answered.get(c.id)?.replyId, body: `${marker(c.id, version)}\n${body}` });
    answered.set(c.id, { replyId: answered.get(c.id)?.replyId, version });
  };
  const removeTheme = async (meta, why) => {
    await rm(themeDir(root, meta.id), { recursive: true, force: true });
    metas.splice(metas.indexOf(meta), 1);
    changes.push({ type: "remove", id: meta.id, name: meta.name, author: meta.author, why });
  };

  // Themes whose comment was deleted, and replies left without a comment.
  for (const meta of [...metas]) {
    if (meta.issue === issue && meta.comment_id && !liveIds.has(meta.comment_id)) await removeTheme(meta, "comment deleted");
  }
  for (const [target, a] of answered) {
    if (!liveIds.has(target)) replies.push({ op: "delete", replyId: a.replyId });
  }

  let evaluations = 0;
  for (const c of live) {
    const version = c.updated_at ?? c.created_at;
    const parsed = parseComment(c.body);
    const meta = metas.find((m) => m.issue === issue && m.comment_id === c.id);
    const done = answered.get(c.id)?.version === version;

    if (parsed.kind === "none") {
      if (meta) {
        await removeTheme(meta, "template removed");
        reply(c, version, `Removed **${meta.name}**: this comment no longer has the \`textus-theme\` block. Put it back to publish the theme again.`);
      } else if (answered.has(c.id) && answered.get(c.id).replyId) {
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
      if (meta && meta.source_updated === version) {
        // Published, but the reply didn't make it (a failed run): just answer.
        reply(c, version, publishedText(c, meta, treeUrl, false));
        continue;
      }
    }
    if (evaluations >= maxEvaluations) continue;
    evaluations++;

    if (parsed.kind === "command") {
      await runRemove(c, parsed, version);
      continue;
    }
    await runSubmission(c, parsed, version, meta);
  }

  async function runRemove(c, parsed, version) {
    const target = metas.find((m) => m.id === parsed.id);
    if (!target) return reply(c, version, `@${c.user.login} There is no theme \`${parsed.id}\`.`);
    let allowed = target.author_id != null && target.author_id === c.user.id;
    if (!allowed) allowed = WRITE_ROLES.has(await gh.permission(c.user.login).catch(() => "none"));
    if (!allowed) return reply(c, version, `@${c.user.login} Only the theme's author or a maintainer can remove \`${parsed.id}\`.`);
    await removeTheme(target, `/remove by @${c.user.login}`);
    removed.push({ id: target.id, name: target.name, author: target.author, issue: target.issue ?? null, comment_id: target.comment_id ?? null, by: c.user.login, at: c.created_at, reason: parsed.reason || null });
    removedDirty = true;
    reply(c, version, `Removed **${target.name}** (\`${target.id}\`). It comes off ${GALLERY_URL} within a few minutes.`);
    const source = target.comment_id && live.find((x) => x.id === target.comment_id);
    if (source) reply(source, source.updated_at ?? source.created_at, `This theme was taken down by @${c.user.login}${parsed.reason ? `: ${parsed.reason}` : "."}`);
  }

  async function runSubmission(c, parsed, version, meta) {
    const login = c.user.login;
    const keep = meta ? `\n\nThe published version stays up until this is fixed.` : "";
    const reject = (errors) =>
      reply(c, version, `@${login} I couldn't publish this theme yet:\n\n${bullet(errors)}\n\nEdit your comment to fix it; it is checked again when you save.${keep}`);

    const errors = [...parsed.errors];
    const { fields, errors: fieldErrors } = validateFields(parsed.fields);
    errors.push(...fieldErrors);
    if (parsed.images.length === 0) errors.push("Add a screenshot of the theme (drag an image into the comment): it is the theme's picture in the gallery.");
    if (parsed.images.length > LIMITS.images) errors.push(`Use at most ${LIMITS.images} screenshots (found ${parsed.images.length}).`);

    let id = meta?.id;
    if (!id && fields.name) {
      id = slugify(fields.name) ?? `theme-${c.id}`;
      const owner = metas.find((m) => m.id === id);
      if (owner && owner.author_id === c.user.id && owner.comment_id)
        errors.push(`You already published **${owner.name}** as \`${id}\` from ${owner.source}. Edit that comment to update it, or pick another name.`);
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
    const checked = validateCss(css);
    errors.push(...checked.errors);

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

    const dir = themeDir(root, id);
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
      created: meta?.created ?? c.created_at,
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
    if (meta) metas.splice(metas.indexOf(meta), 1, next);
    else metas.push(next);
    changes.push({ type: meta ? "update" : "publish", id, name: next.name, author: login });
    reply(c, version, publishedText(c, next, treeUrl, Boolean(meta)));
  }

  if (removedDirty) await writeFile(join(root, "removed.json"), `${JSON.stringify(removed, null, 2)}\n`);
  // One reply per comment: a later answer in the same run replaces an earlier one.
  const last = new Map();
  replies.forEach((r, i) => r.op === "upsert" && last.set(r.target, i));
  return { changes, replies: replies.filter((r, i) => r.op !== "upsert" || last.get(r.target) === i) };
}

function publishedText(c, meta, treeUrl, updated) {
  return `@${c.user.login} ${updated ? "Updated" : "Published"} **${meta.name}** as [\`${meta.id}\`](${treeUrl(meta.id)}). It shows on ${GALLERY_URL} within a few minutes.

Edit this comment to update the theme; delete the comment to take it down.`;
}
