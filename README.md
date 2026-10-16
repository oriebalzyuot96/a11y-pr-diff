# a11y-pr-diff

A GitHub Action that runs [axe-core](https://github.com/dequelabs/axe-core) on a set of static HTML pages for the base branch and for the pull request branch, then comments **only on accessibility violations the PR introduces**. Violations that already existed are ignored, and fixed ones are listed as fixed.

## How it works

1. The workflow checks out the PR's base commit and head commit into two folders.
2. The CLI loads every `.html` file in each side's pages folder.
3. Each page is loaded into jsdom and axe-core runs inside that window. Results are reduced to `{ id, impact, help, nodes: [{ target }] }`.
4. A violation's identity is `(page path, rule id, target selector)`. The CLI compares the two runs:
   - **new**: present in head only
   - **fixed**: present in base only
   - **unchanged**: present in both
5. New violations are printed as markdown. The workflow posts the markdown as a PR comment, updating its previous comment if one exists. Nothing is posted when there are no new violations.
6. The job fails (exit 1) when any new violation is `serious` or `critical`.

## Usage

```sh
npm install
node src/cli.js --base <dir-or-list.json> --head <dir>
```

- `--base` and `--head` are folders of `.html` files (searched recursively), or, for `--base` only, a `.json` file containing an array of HTML paths relative to that file.
- Page identity is the path relative to the folder. A page that exists only on head is treated as new. A page that exists only on base is treated as fixed.
- Markdown for new violations goes to stdout. A one-line summary goes to stderr.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | No new serious or critical violations |
| 1 | At least one new serious or critical violation |
| 2 | Usage error, missing path, or scan failure |

Tests: `npm test` (uses `node:test`).

## GitHub Action

`.github/workflows/a11y.yml` runs on `pull_request`. It needs no secrets. Its permissions are `contents: read` and `pull-requests: write`, which is what it needs to post the comment.

The workflow expects this package at the repository root, because it runs the tool from the base checkout (`base/src/cli.js`). It reads pages from `PAGES_DIR` (default `pages`). Change that variable to match your repository.

Pull requests from forks get a read-only token, so the comment step will fail for them. The scan and the exit code still work.

## Limits

- **Static HTML snapshots only.** Pages are scanned as files, not rendered from a running app, so client-side rendered content and JavaScript-driven state are not checked.
- **No login flows.** Pages behind authentication, cookies, or multi-step interactions cannot be scanned.
- **jsdom is not a browser.** There is no real layout or rendering, so rules that depend on computed colors or visibility (such as color contrast) are often reported as incomplete rather than as violations.
- **Identity is by selector.** If an element's CSS selector changes, for example from `img:nth-child(3)` to `img:nth-child(4)` after reordering, the change shows up as one fixed and one new violation.
- **axe finds only part of WCAG.** axe-core automates detection of roughly a third of WCAG issues. A clean run does not mean the page is accessible. Manual testing with assistive technology is still needed.
