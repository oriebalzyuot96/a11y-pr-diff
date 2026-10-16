/**
 * Pure comparison of two axe-core scans.
 *
 * Input shape: a plain object mapping a page path to its violations, e.g.
 *   { "index.html": [{ id, impact, help, nodes: [{ target }] }] }
 *
 * A violation's identity is (page path, rule id, target selector). A violation
 * with several nodes produces one identity per node.
 */

export const SEVERE_IMPACTS = Object.freeze(['serious', 'critical']);

export function isSevere(impact) {
  return SEVERE_IMPACTS.includes(impact);
}

/**
 * Flatten a scan into a Map keyed by identity.
 * @returns {Map<string, {key: string, page: string, id: string, impact: string|null, help: string, target: string}>}
 */
export function flattenViolations(results) {
  const entries = new Map();
  for (const page of Object.keys(results ?? {}).sort()) {
    for (const violation of results[page] ?? []) {
      const targets = violation.nodes?.length ? violation.nodes.map((node) => node.target) : [''];
      for (const target of targets) {
        const key = JSON.stringify([page, violation.id, target]);
        if (!entries.has(key)) {
          entries.set(key, {
            key,
            page,
            id: violation.id,
            impact: violation.impact ?? null,
            help: violation.help ?? '',
            target,
          });
        }
      }
    }
  }
  return entries;
}

/**
 * Compare a base scan with a head scan.
 * @returns {{newViolations: object[], fixed: object[], unchanged: object[]}}
 */
export function compareRuns(baseResults, headResults) {
  const base = flattenViolations(baseResults);
  const head = flattenViolations(headResults);

  const newViolations = [];
  const unchanged = [];
  for (const [key, entry] of head) {
    (base.has(key) ? unchanged : newViolations).push(entry);
  }

  const fixed = [];
  for (const [key, entry] of base) {
    if (!head.has(key)) fixed.push(entry);
  }

  return { newViolations, fixed, unchanged };
}
