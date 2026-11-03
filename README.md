# Textus Themes

Free, open themes for [Textus](https://textus.catvinci.com), the Markdown editor, shared by the people who use it.
Browse them at **[textus.catvinci.com/themes](https://textus.catvinci.com/themes/)**.

Sharing a theme takes one GitHub comment: no fork, no pull request.
Post it on the **[theme gallery issue](https://github.com/CatVinci-Studio/textus-themes/issues/1)**. A bot checks it right away; once a maintainer has reviewed it, it is published here and on the website.

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
Chinese: 适合长文写作的安静衬线主题，暖色纸面配深色墨迹。
License: MIT
```

```css
/* Paste your whole theme here, or delete this block and drag your .css file into the comment. */
```

<!-- Drag two screenshots of the theme below, light appearance first, then dark (PNG, JPEG or WebP, up to 2 MB each). -->
````

- **Name** - shown on the card; it also gives the theme its id (`Inkwell` becomes `inkwell`). First come, first served.
- **Description** - one or two sentences, in your own words (300 characters at most).
- **Chinese** - optional: the description in Chinese, which Chinese readers see instead. Leave it blank if you'd rather not.
- **License** - an OSI-approved [SPDX id](https://spdx.org/licenses/) such as `MIT`, `Apache-2.0`, `BSD-3-Clause`, `GPL-3.0-only` or `OFL-1.1`. Leave it blank for MIT.
- **The CSS** - in a ` ```css ` block, or as an attached file: drag `my-theme.css` into the comment box (if GitHub refuses the `.css` file, rename it to `my-theme.css.txt`).
- **Screenshots** - two images dragged into the comment: the theme in light appearance first, then in dark. The gallery shows the one that matches the reader's appearance, and both when enlarged; 1280x800 looks best. One is enough for a theme with a single look.

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

