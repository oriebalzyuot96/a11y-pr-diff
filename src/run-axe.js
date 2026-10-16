import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(join(dirname(require.resolve('axe-core')), 'axe.min.js'), 'utf8');

/**
 * Run axe-core against one HTML document inside a jsdom window.
 *
 * @param {string} html    Full HTML source of the page.
 * @param {string} pageId  Page path, used for error messages.
 * @returns {Promise<Array<{id: string, impact: string|null, help: string, nodes: Array<{target: string}>}>>}
 */
export async function runAxe(html, pageId = 'page') {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  try {
    window.eval(AXE_SOURCE);
    const result = await window.axe.run(window.document, { resultTypes: ['violations'] });
    return result.violations.map(normalizeViolation);
  } catch (err) {
    throw new Error(`axe-core failed on ${pageId}: ${err.message}`, { cause: err });
  } finally {
    window.close();
  }
}

function normalizeViolation(violation) {
  return {
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({ target: formatTarget(node.target) })),
  };
}

// axe reports a target as an array of selector parts: one entry per frame or
// shadow boundary, where each entry is a string or an array of strings.
// Flatten it into one readable string, e.g. "iframe >> .btn".
function formatTarget(target) {
  return target
    .map((part) => (Array.isArray(part) ? part.join(' ') : String(part)))
    .join(' >> ');
}
