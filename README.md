# Textus Themes

Free, open themes for [Textus](https://textus.catvinci.com), the Markdown editor, shared by the people who use it.
Browse them at **[textus.catvinci.com/themes](https://textus.catvinci.com/themes/)**.

Sharing a theme takes one GitHub comment: no fork, no pull request.
Post it on the **[theme gallery issue](https://github.com/CatVinci-Studio/textus-themes/issues/1)**. A bot checks it right away; once a maintainer has reviewed it, it is published here and on the website.

[中文说明](#中文说明)

## Install a theme

1. On the [gallery](https://textus.catvinci.com/themes/), press **Download CSS** on a theme (or open its `theme.css` in [`themes/`](themes/)).
2. In Textus, open **Settings › Editor & Appearance**, choose **Import CSS…** and pick the downloaded file.

Themes are Typora-compatible stylesheets, so most of them also work in Typora.

## Share a theme

Post a comment on the [gallery issue](https://github.com/CatVinci-Studio/textus-themes/issues/1) in this shape:

````markdown
```textus-theme
Name: Inkwell
Description: A quiet serif theme for long-form writing, with warm paper and dark ink.
License: MIT
```

```css
/* Paste your whole theme here, or delete this block and drag your .css file into the comment. */
```

<!-- Drag one or two screenshots of the theme below (PNG, JPEG or WebP, up to 2 MB each). -->
````

- **Name** - shown on the card; it also gives the theme its id (`Inkwell` becomes `inkwell`). First come, first served.
- **Description** - one or two sentences, in your own words (300 characters at most).
- **License** - an OSI-approved [SPDX id](https://spdx.org/licenses/) such as `MIT`, `Apache-2.0`, `BSD-3-Clause`, `GPL-3.0-only` or `OFL-1.1`. Leave it blank for MIT.
- **The CSS** - in a ` ```css ` block, or as an attached file: drag `my-theme.css` into the comment box (if GitHub refuses the `.css` file, rename it to `my-theme.css.txt`).
- **Screenshots** - one or two images dragged into the comment. The first one is the theme's picture in the gallery; 1280x800 in light appearance looks best.

The bot answers your comment within a minute or two: either a list of what to fix, or word that the theme passed the checks and is **waiting for a maintainer's review**. A maintainer looks at it (usually within a few days) and approves it, and it appears on the website; if it isn't accepted, the bot tells you why.

**To update** your theme, edit the comment. The new version is checked and reviewed again; the published one stays up until the new one is approved.

**To take it down**, delete the comment, or post `/remove <id>`.

Comments without the `textus-theme` block are ordinary discussion and are left alone.

## Rules

- **License.** By posting, you share the theme under the license in the `License:` field: MIT unless you name another OSI-approved license. Only share what you have the right to share, fonts included.
- **One self-contained file, no remote resources.** `@import` is not allowed, and every `url()` must be a `data:` URI of an image or a font. Embed what the theme needs, or leave it out. (Textus loads a theme as a single stylesheet; a theme that fetches files would break offline and would tell a server whenever someone opens it.)
- **No script hooks:** `expression()`, `javascript:` URLs, `behavior` and `-moz-binding` are refused.
- **Limits:** the CSS up to 200 KB; one or two screenshots, PNG, JPEG or WebP, up to 2 MB each.
- **The CSS must parse.** The bot reports the line of the first syntax error.
- Be kind. A theme that copies someone else's work without credit, or that is offensive, is taken down by a maintainer.

## Writing a theme

The fastest start is one of the themes here: the gallery opens with four by CatVinci Studio, [Midnight Ink](themes/midnight-ink/theme.css) (a dark page for night writing), [Manuscript](themes/manuscript/theme.css) (a typewritten draft), [Lumen](themes/lumen/theme.css) (a modern sans with a violet accent) and [Plain](themes/plain/theme.css) (Textus's Default look without the level-3 and level-4 heading marks). Or use **Export** in Textus's **Settings › Editor & Appearance**, which writes the current look out as a stylesheet you can edit and import again.

- `#write` is the document, as in Typora. Plain element selectors (`blockquote`, `table td`) win over Textus's own look.
- Textus reads these variables for its own parts (source view, find highlights, the window around the page): `--editor-bg`, `--editor-text`, `--editor-muted`, `--editor-accent`, `--editor-border`, `--editor-code-bg`, `--editor-quote-border`, `--editor-highlight-bg`, `--editor-font`.
- An imported theme keeps one design in both light and dark appearance.
- Name CJK fonts in your font stacks (`"Songti SC"`, `"Noto Serif CJK SC"`, ...), or Chinese and Japanese text falls back to a system default.

## For maintainers

- `.github/workflows/publish-theme.yml` runs on every comment created, edited or deleted on an issue labelled `theme-gallery`. `scripts/publish.mjs` compares **all** the issue's comments with `themes/` and `pending/`, so a run GitHub skips is caught up by the next; you can also run the workflow by hand from the Actions tab.
- **Review.** A submission that passes the checks is copied to `pending/<id>/` (not in `index.json`, not on the website) and the bot mentions the maintainers. Look at `pending/<id>/theme.css` and its preview, then comment `/approve <id>` to publish exactly that version, or `/reject <id> <reason>` to turn it down (the author is told the reason). Only accounts with write access can approve or reject. An edit after approval goes back to `pending/`; the approved version stays live until the new one is approved.
- `/remove <id> [reason]` from anyone with write access (or the theme's author) takes a theme down and records it in `removed.json`; its comment is not published again. To undo, delete the entry from `removed.json` and run the workflow by hand.
- `themes/<id>/` holds `theme.css`, `preview.*` and `meta.json`, and `theme-dark.css` when the theme has a dark form (`"darkCss": "theme-dark.css"` in `meta.json`): Textus switches to it with the appearance. Every theme here has both. `index.json` is generated from them (`npm run index`) and is what the website and Textus read; a daily workflow adds each theme's installs, from Textus's anonymous install counts.
- `npm test` runs the checks (`node --test`).

The code in this repository is MIT-licensed (see [LICENSE](LICENSE)); each theme carries the license its author chose, in its `meta.json` and at the top of its `theme.css`.

---

## 中文说明

这里收录大家为 [Textus](https://textus.catvinci.com) 制作的主题，全部免费、开放。在 **[textus.catvinci.com/themes](https://textus.catvinci.com/zh/themes/)** 浏览。

**安装主题：** 在主题页点“下载 CSS”，然后在 Textus 里打开 **设置 › 编辑与外观 › 导入 CSS…**，选择下载的文件。

**分享主题：** 不需要 fork，也不需要提交 PR。只要在[主题画廊 issue](https://github.com/CatVinci-Studio/textus-themes/issues/1) 下按上面的模板发一条评论：

1. `textus-theme` 代码块里填写 `Name:`（名称）、`Description:`（一两句介绍）、`License:`（许可证，留空即为 MIT）；
2. 把整份主题 CSS 粘贴进 ` ```css ` 代码块，或者直接把 `.css` 文件拖进评论框（GitHub 不接受 `.css` 时，改名为 `.css.txt` 即可）；
3. 拖入一到两张主题截图（PNG、JPEG 或 WebP，每张不超过 2 MB）。

机器人会自动检查并回复：没通过会列出需要修改的地方；通过了会进入**等待维护者审核**状态。维护者审核通过后，主题才会发布到网站上；如果没有通过，机器人会告诉你原因。

**更新**：直接编辑你的评论，新版本会重新检查并审核，审核通过前旧版本保持上线。**下架**：删除评论，或者回复 `/remove <id>`。

**维护者**：审核 `pending/<id>/` 里的主题后，回复 `/approve <id>` 发布，或 `/reject <id> <原因>` 退回。

**规则：** 主题默认以 MIT 许可分享（也可以写其他 OSI 认可的许可证）；不能用 `@import`，所有 `url()` 必须是 `data:` 形式内嵌的图片或字体（不允许加载任何远程文件）；CSS 不超过 200 KB，必须能正确解析；不允许 `expression()`、`javascript:`、`behavior`、`-moz-binding`。字体请写上中文字体名（如 `"Songti SC"`、`"Noto Serif CJK SC"`），否则中文会回退到系统默认字体。
