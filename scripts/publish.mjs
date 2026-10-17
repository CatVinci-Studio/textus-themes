// Run by .github/workflows/publish-theme.yml on every comment created,
// edited or deleted on an issue labelled theme-gallery (and by hand, from
// the Actions tab, to resync every gallery issue).
//
//   1. lib/gallery.mjs reconciles themes/ and pending/ with the issue's comments
//   2. index.json is rebuilt, and any change is committed and pushed to main
//   3. only then are the bot's replies posted, so every link in them works
//
// Needs GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH (Actions sets
// the last two). Exits non-zero on a failure, which leaves state untouched
// for the next run to retry.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeIndex } from "./lib/catalog.mjs";
import { syncIssue } from "./lib/gallery.mjs";
import { createGitHub } from "./lib/github.mjs";

export const LABEL = "theme-gallery";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
const gh = createGitHub({ token, repo });

const issues = event.issue
  ? [event.issue].filter((i) => i.labels?.some((l) => l.name === LABEL))
  : await gh.galleryIssues(LABEL);

const changes = [];
const pending = [];
for (const issue of issues) {
  const comments = await gh.listComments(issue.number);
  const result = await syncIssue({ root, repo, issue: issue.number, comments, gh });
  changes.push(...result.changes);
  pending.push(...result.replies.map((r) => ({ ...r, issue: issue.number })));
}

await writeIndex(root);
if (git("status", "--porcelain", "--", "themes", "pending", "index.json", "removed.json")) {
  const summary = changes.map((c) => `${c.type} ${c.id}${["publish", "update", "pending"].includes(c.type) ? ` by @${c.author}` : ""}`).join(", ") || "rebuild index";
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git("add", "--all", "--", "themes", "pending", "index.json", "removed.json");
  git("commit", "--quiet", "-m", `chore(gallery): ${summary}`.slice(0, 200), "-m", changes.map((c) => `- ${c.type}: ${c.name} (${c.id})${c.why ? `, ${c.why}` : ""}`).join("\n") || "index.json");
  // The concurrency group keeps runs apart, but a person may push to main.
  for (let attempt = 1; ; attempt++) {
    try {
      git("push", "origin", "HEAD:main");
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      git("pull", "--rebase", "origin", "main");
    }
  }
  console.log(`Pushed: ${changes.map((c) => `${c.type} ${c.id}`).join(", ")}`);
}

for (const r of pending) {
  if (r.op === "delete") await gh.deleteComment(r.replyId).catch((e) => console.warn(e.message));
  else if (r.replyId && !r.fresh) await gh.updateComment(r.replyId, r.body);
  else {
    // A fresh reply (a theme waiting for review) is posted anew, not edited
    // in, so the maintainers it mentions are notified.
    if (r.replyId) await gh.deleteComment(r.replyId).catch((e) => console.warn(e.message));
    await gh.createComment(r.issue, r.body);
  }
}
console.log(`${issues.length} gallery issue(s), ${changes.length} change(s), ${pending.length} repl(ies).`);
