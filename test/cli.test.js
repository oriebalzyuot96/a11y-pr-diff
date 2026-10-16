import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';

// Fake axe: a page marked with data-fake="<impact>" reports one violation of that impact.
// Lets exit-code tests run without loading axe-core for every case.
const fakeRunAxe = async (html) => {
  const m = html.match(/data-fake="([^"]*)"/);
  return m ? [{ id: 'fake-rule', impact: m[1], help: 'fake', nodes: [{ target: '#x' }] }] : [];
};

const page = (attrs = '', body = '<main><h1>Title</h1></main>') =>
  `<!doctype html><html lang="en"${attrs}><head><title>T</title></head><body>${body}</body></html>`;

const GOOD = page('', '<main><h1>Title</h1><img src="a.png" alt="A"></main>');
const MISSING_ALT = page('', '<main><h1>Title</h1><img src="a.png"></main>');

let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'a11y-pr-diff-test-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeSide(name, files) {
  const dir = join(root, name);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

function capture() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    stdout: { write: (s) => (out.stdout += s) },
    stderr: { write: (s) => (out.stderr += s) },
  };
}

test('identical sides exit 0 with no markdown (real axe-core)', async () => {
  const base = await makeSide('same-base', { 'index.html': GOOD });
  const head = await makeSide('same-head', { 'index.html': GOOD });
  const io = capture();
  const code = await main(['--base', base, '--head', head], io);

  assert.equal(code, 0);
  assert.equal(io.out.stdout, '');
  assert.match(io.out.stderr, /New: 0/);
});

test('a new image without alt exits 1 and is printed as markdown (real axe-core)', async () => {
  const base = await makeSide('alt-base', { 'index.html': GOOD });
  const head = await makeSide('alt-head', { 'index.html': GOOD, 'shop/product.html': MISSING_ALT });
  const io = capture();
  const code = await main(['--base', base, '--head', head], io);

  assert.equal(code, 1);
  assert.match(io.out.stdout, /## Accessibility: new violations/);
  assert.match(io.out.stdout, /### `shop\/product\.html`/);
  assert.match(io.out.stdout, /\*\*critical\*\* `image-alt`/);
});

test('new violations below serious exit 0 but are still printed', async () => {
  const base = await makeSide('minor-base', { 'index.html': page() });
  const head = await makeSide('minor-head', { 'index.html': page(' data-fake="moderate"') });
  const io = capture();
  const code = await main(['--base', base, '--head', head], { ...io, runAxe: fakeRunAxe });

  assert.equal(code, 0);
  assert.match(io.out.stdout, /fake-rule/);
});

test('new serious violation exits 1 (fake axe)', async () => {
  const base = await makeSide('serious-base', { 'a.html': page() });
  const head = await makeSide('serious-head', { 'a.html': page(' data-fake="serious"') });
  const io = capture();
  assert.equal(await main(['--base', base, '--head', head], { ...io, runAxe: fakeRunAxe }), 1);
});

test('new critical violation exits 1 (fake axe)', async () => {
  const base = await makeSide('critical-base', { 'a.html': page() });
  const head = await makeSide('critical-head', { 'a.html': page(' data-fake="critical"') });
  const io = capture();
  assert.equal(await main(['--base', base, '--head', head], { ...io, runAxe: fakeRunAxe }), 1);
});

test('only fixed violations exit 0, print no markdown, and report the fix', async () => {
  const base = await makeSide('fixed-base', { 'a.html': page(' data-fake="critical"') });
  const head = await makeSide('fixed-head', { 'a.html': page() });
  const io = capture();
  const code = await main(['--base', base, '--head', head], { ...io, runAxe: fakeRunAxe });

  assert.equal(code, 0);
  assert.equal(io.out.stdout, '');
  assert.match(io.out.stderr, /Fixed: 1/);
});

test('a .json list of HTML paths works as --base', async () => {
  const base = await makeSide('list-base', { 'index.html': GOOD, 'pages/x.html': GOOD });
  await writeFile(join(base, 'pages.json'), JSON.stringify(['index.html', 'pages/x.html']));
  const head = await makeSide('list-head', { 'index.html': GOOD, 'pages/x.html': MISSING_ALT });
  const io = capture();
  const code = await main(['--base', join(base, 'pages.json'), '--head', head], io);

  assert.equal(code, 1);
  assert.match(io.out.stdout, /### `pages\/x\.html`/);
});

test('usage errors exit 2', async () => {
  const dir = await makeSide('usage', { 'index.html': GOOD });
  const cases = [
    [],
    ['--base', dir],
    ['--head', dir],
    ['--base', dir, '--head'],
    ['--base', dir, '--head', dir, '--bogus'],
  ];
  for (const argv of cases) {
    const io = capture();
    assert.equal(await main(argv, io), 2, `argv: ${argv.join(' ')}`);
    assert.match(io.out.stderr, /Usage|required|requires|Unknown/);
  }
});

test('a missing directory exits 2', async () => {
  const dir = await makeSide('missing', { 'index.html': GOOD });
  const io = capture();
  assert.equal(await main(['--base', join(root, 'does-not-exist'), '--head', dir], io), 2);
  assert.match(io.out.stderr, /Not found/);
});

test('--help exits 0', async () => {
  const io = capture();
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.out.stdout, /Usage: a11y-pr-diff/);
});
