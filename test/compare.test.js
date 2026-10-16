import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns, flattenViolations, isSevere } from '../src/compare.js';

const v = (id, target, impact = 'serious') => ({
  id,
  impact,
  help: `${id} help`,
  nodes: [{ target }],
});

const keysOf = (list) => list.map((e) => `${e.page} ${e.id} ${e.target}`);

test('identical runs give no new and no fixed violations', () => {
  const run = {
    'index.html': [v('image-alt', 'img.hero'), v('label', 'input#email')],
    'about.html': [v('link-name', 'a.more')],
  };
  const diff = compareRuns(run, structuredClone(run));

  assert.deepEqual(diff.newViolations, []);
  assert.deepEqual(diff.fixed, []);
  assert.equal(diff.unchanged.length, 3);
});

test('a violation present only in head is reported as new', () => {
  const base = { 'index.html': [v('image-alt', 'img.hero')] };
  const head = {
    'index.html': [v('image-alt', 'img.hero'), v('button-name', 'button.menu', 'critical')],
  };
  const diff = compareRuns(base, head);

  assert.deepEqual(keysOf(diff.newViolations), ['index.html button-name button.menu']);
  assert.equal(diff.newViolations[0].impact, 'critical');
  assert.equal(diff.newViolations[0].help, 'button-name help');
  assert.deepEqual(diff.fixed, []);
});

test('a violation present only in base is listed as fixed', () => {
  const base = { 'index.html': [v('image-alt', 'img.hero'), v('label', 'input#q')] };
  const head = { 'index.html': [v('label', 'input#q')] };
  const diff = compareRuns(base, head);

  assert.deepEqual(diff.newViolations, []);
  assert.deepEqual(keysOf(diff.fixed), ['index.html image-alt img.hero']);
  assert.equal(diff.unchanged.length, 1);
});

test('same rule and selector on a different page counts as new', () => {
  const base = { 'index.html': [v('image-alt', 'img')] };
  const head = { 'index.html': [v('image-alt', 'img')], 'contact.html': [v('image-alt', 'img')] };
  const diff = compareRuns(base, head);

  assert.deepEqual(keysOf(diff.newViolations), ['contact.html image-alt img']);
});

test('same rule on a different selector counts as new, and the old one is fixed', () => {
  const base = { 'index.html': [v('image-alt', 'img.a')] };
  const head = { 'index.html': [v('image-alt', 'img.b')] };
  const diff = compareRuns(base, head);

  assert.deepEqual(keysOf(diff.newViolations), ['index.html image-alt img.b']);
  assert.deepEqual(keysOf(diff.fixed), ['index.html image-alt img.a']);
});

test('a violation with several nodes yields one identity per node', () => {
  const head = {
    'index.html': [{ id: 'image-alt', impact: 'critical', help: 'h', nodes: [{ target: 'img.a' }, { target: 'img.b' }] }],
  };
  const diff = compareRuns({}, head);

  assert.deepEqual(keysOf(diff.newViolations), ['index.html image-alt img.a', 'index.html image-alt img.b']);
});

test('duplicate identities within one run are counted once', () => {
  const head = { 'index.html': [v('image-alt', 'img'), v('image-alt', 'img')] };
  assert.equal(compareRuns({}, head).newViolations.length, 1);
  assert.equal(flattenViolations(head).size, 1);
});

test('an empty base makes every head violation new, and an empty head fixes everything', () => {
  const run = { 'index.html': [v('image-alt', 'img')] };
  assert.equal(compareRuns({}, run).newViolations.length, 1);
  assert.equal(compareRuns(run, {}).fixed.length, 1);
});

test('missing impact is kept as null and is not severe', () => {
  const head = { 'index.html': [{ id: 'x', impact: null, help: 'h', nodes: [{ target: 'p' }] }] };
  const [entry] = compareRuns({}, head).newViolations;

  assert.equal(entry.impact, null);
  assert.equal(isSevere(entry.impact), false);
});

test('isSevere is true only for serious and critical', () => {
  assert.equal(isSevere('critical'), true);
  assert.equal(isSevere('serious'), true);
  assert.equal(isSevere('moderate'), false);
  assert.equal(isSevere('minor'), false);
  assert.equal(isSevere(null), false);
});
