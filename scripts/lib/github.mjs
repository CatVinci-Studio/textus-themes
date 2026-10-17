// The few GitHub REST calls the publisher makes, with the workflow's
// GITHUB_TOKEN. Attachments are downloaded without it: they are public for
// a public repository, and the token must not follow the redirect to the
// asset host.
const API = "https://api.github.com";

export function createGitHub({ token, repo }) {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "textus-themes-publisher",
  };
  async function call(method, path, body) {
    const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    return res.status === 204 ? null : res.json();
  }
  async function paged(path) {
    const all = [];
    for (let page = 1; ; page++) {
      const batch = await call("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) return all;
    }
  }
  return {
    galleryIssues: (label) => paged(`/repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=all`).then((l) => l.filter((i) => !i.pull_request)),
    listComments: (issue) => paged(`/repos/${repo}/issues/${issue}/comments`),
    permission: async (login) => (await call("GET", `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`)).permission,
    createComment: (issue, body) => call("POST", `/repos/${repo}/issues/${issue}/comments`, { body }),
    updateComment: (id, body) => call("PATCH", `/repos/${repo}/issues/comments/${id}`, { body }),
    deleteComment: (id) => call("DELETE", `/repos/${repo}/issues/comments/${id}`),
    download,
  };
}

/** Fetches a URL into a Buffer, stopping once it is past maxBytes. */
export async function download(url, maxBytes) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "textus-themes-publisher" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel();
    return Buffer.alloc(maxBytes + 1);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > maxBytes) break;
  }
  return Buffer.concat(chunks);
}
