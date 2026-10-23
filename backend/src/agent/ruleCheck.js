/**
 * Does a verdict follow its rule book?
 *
 * The system prompt tells the analyst to walk R1 → R3 → R4 → R7 → R5 and let
 * the first rule that FIRED set the action, and allows its own judgment to
 * make a verdict more cautious than that rule but never less disciplined
 * (prompts/system.js, "How to apply them"). Nothing checked that it did: a
 * model answering "hold" on a fired stop went into the track record as an
 * ordinary hold. This reads the same rule book the brief showed the model
 * and classifies the action it returned. It only reports; it never changes a
 * verdict.
 */

const SELLS = ['exit', 'reduce', 'take_profit'];

/**
 * What the rule book allows for one held position.
 *
 * @param {object} ruleBook - analyze.js buildRuleBook output
 * @returns {{rule: string, expected: string[], allowed: string[]}}
 *   rule: the rule that decides ('none' when nothing fired); expected: the
 *   actions that follow it as written; allowed: those plus the ones the
 *   prompt accepts as more cautious.
 */
export function ruleBookExpectation(ruleBook) {
  const { stop, target, partialProfit, relativeWeakness, averagingDown } = ruleBook;

  if (stop?.fired) {
    // The fundamental-hold options are the only alternatives to a full exit.
    const fh = stop.fundamentalHold;
    const expected = ['exit'];
    if (fh?.eligible) expected.push('reduce');
    if (fh?.eligible && fh.holdThrough) expected.push('hold');
    return { rule: 'R1', expected, allowed: expected };
  }
  if (target?.fired) return { rule: 'R3', expected: ['take_profit'], allowed: SELLS };
  if (partialProfit?.fired) return { rule: 'R4', expected: ['reduce'], allowed: SELLS };
  if (relativeWeakness?.fired) return { rule: 'R7', expected: ['reduce'], allowed: SELLS };
  // One close under the stop on a style that needs two: the prompt says hold,
  // never a sale on that close.
  if (stop?.warning) return { rule: 'R1-warning', expected: ['hold'], allowed: ['hold'] };
  if (averagingDown?.fired) return { rule: 'R5', expected: ['accumulate'], allowed: ['accumulate', 'hold', 'wait', ...SELLS] };
  return { rule: 'none', expected: ['hold'], allowed: ['hold', 'wait', ...SELLS] };
}

/**
 * @param {object} ruleBook - analyze.js buildRuleBook output
 * @param {string} action - the verdict's action
 * @returns {{rule: string, expected: string[], action: string, outcome: 'follows'|'more_cautious'|'contradicts'}}
 */
export function checkAgainstRuleBook(ruleBook, action) {
  const { rule, expected, allowed } = ruleBookExpectation(ruleBook);
  const outcome = expected.includes(action) ? 'follows' : allowed.includes(action) ? 'more_cautious' : 'contradicts';
  return { rule, expected, action, outcome };
}

/**
 * Checks model-written verdicts on held positions against their rule books,
 * logs one `[rule-check]` line per verdict (warn when it contradicts) and
 * returns the verdicts with a `ruleCheck` field. A verdict with no matching
 * held analysis or rule book is returned unchanged.
 *
 * @param {object[]} verdicts - each with code and action
 * @param {object[]} analyses - analyze.js output, held positions carry position.ruleBook
 * @param {string} feature - 'portfolio_review' or 'stock_review', for the log line
 */
export function attachRuleChecks(verdicts, analyses, feature) {
  const ruleBooks = new Map(analyses.filter((a) => a.position?.ruleBook).map((a) => [a.code, a.position.ruleBook]));
  return verdicts.map((v) => {
    const ruleBook = ruleBooks.get(v.code);
    if (!ruleBook || !v.action) return v;
    const check = checkAgainstRuleBook(ruleBook, v.action);
    const line = `[rule-check] ${feature} ${v.code} ${check.rule} expected=${check.expected.join('|')} got=${check.action} ${check.outcome}`;
    if (check.outcome === 'contradicts') console.warn(line);
    else console.log(line);
    return { ...v, ruleCheck: check };
  });
}
