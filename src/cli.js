#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRuns, isSevere } from './compare.js';
import { runAxe as defaultRunAxe } from './run-axe.js';

export const USAGE = 'Usage: a11y-pr-diff --base <dir-or-html-list.json> --head <dir>';

class UsageError extends Error {}

/**
 * Parse CLI arguments. Throws UsageError on bad input.
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      args.help = true;
    } else if (flag === '--base' || flag === '--head') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${flag} requires a value`);
      }
      args[flag.slice(2)] = value;
    } else {
      throw new UsageError(`Unknown argument: ${flag}`);
    }
  }
  if (!args.help && (!args.base || !args.head)) {
    throw new UsageError('--base and --head are required');
  }
  return args;
}

/**
 * List the pages of one side. Returns [{ pageId, file }].
 * - A directory: every .html/.htm file under it, recursively.
 * - A .json file: an array of HTML paths, relative to the JSON file.
 */
export async function listPages(source) {
  const root = resolve(source);
  const info = await stat(root).catch(() => {
    throw new UsageError(`Not found: ${source}`);
  });

  if (info.isDirectory()) {
    const files = await walkHtml(root);
    return files
      .map((file) => ({ pageId: relative(root, file).split(sep).join(posix.sep), file }))
      .sort((a, b) => (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0));
  }

  if (root.toLowerCase().endsWith('.json')) {
    let entries;
    try {
      entries = JSON.parse(await readFile(root, 'utf8'));
    } catch (err) {
      throw new UsageError(`Could not read ${source} as JSON: ${err.message}`);
    }
    if (!Array.isArray(entries) || !entries.every((e) => typeof e === 'string')) {
      throw new UsageError(`${source} must contain a JSON array of HTML file paths`);
    }
    const base = dirname(root);
    return entries.map((entry) => ({
      pageId: posix.normalize(entry.split(sep).join(posix.sep)),
      file: resolve(base, entry),
    }));
  }

  throw new UsageError(`${source} is neither a directory nor a .json list`);
}

async function walkHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkHtml(full)));
    } else if (/\.html?$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan every page of one side. Returns { [pageId]: violations }.
 */
export async function scan(source, runAxe) {
  const results = {};
  for (const { pageId, file } of await listPages(source)) {
    const html = await readFile(file, 'utf8');
    results[pageId] = await runAxe(html, pageId);
  }
  return results;
}

/**
 * Markdown for new violations, grouped by page.
 */
export function formatMarkdown(diff) {
  const severe = diff.newViolations.filter((v) => isSevere(v.impact)).length;
  const lines = [
    '## Accessibility: new violations in this PR',
    '',
    `This PR adds ${diff.newViolations.length} new axe-core violation(s), ` +
      `${severe} of them serious or critical.`,
  ];

  const pages = [...new Set(diff.newViolations.map((v) => v.page))];
  for (const page of pages) {
    lines.push('', `### \`${page}\``);
    for (const v of diff.newViolations.filter((x) => x.page === page)) {
      lines.push(`- **${v.impact ?? 'unknown'}** \`${v.id}\`: ${v.help}`);
      lines.push(`  - target: \`${v.target}\``);
    }
  }

  if (diff.fixed.length) {
    lines.push('', `_${diff.fixed.length} violation(s) fixed by this PR._`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Run the CLI. Returns the exit code:
 *   0 no new serious/critical violations, 1 new serious/critical, 2 usage or I/O error.
 * New violations of any impact are written to stdout as markdown.
 */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr, runAxe = defaultRunAxe } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr.write(`${err.message}\n${USAGE}\n`);
    return 2;
  }
  if (args.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  try {
    const baseResults = await scan(args.base, runAxe);
    const headResults = await scan(args.head, runAxe);
    const diff = compareRuns(baseResults, headResults);
    const severe = diff.newViolations.filter((v) => isSevere(v.impact));

    stderr.write(
      `Pages: ${Object.keys(baseResults).length} base, ${Object.keys(headResults).length} head. ` +
        `New: ${diff.newViolations.length} (${severe.length} serious/critical). ` +
        `Fixed: ${diff.fixed.length}. Unchanged: ${diff.unchanged.length}.\n`,
    );
    if (diff.newViolations.length) {
      stdout.write(formatMarkdown(diff));
    }
    return severe.length ? 1 : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`${err.message}\n`);
    } else {
      stderr.write(`Error: ${err.message}\n`);
    }
    return 2;
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  process.exitCode = await main(process.argv.slice(2));
}
