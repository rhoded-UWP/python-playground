/* =========================================================
   Problem Sets - answer validator (server-side only)

   This module is the ONE place where "is this answer correct?" is
   decided. Keeping the rule in a single function means we can loosen
   the matching later (trim whitespace, ignore case, accept synonyms,
   or even run the student's code) by editing one function, without
   touching the API routes, the loader, or the front end.

   It ships as an EXACT match on the raw expected string, on purpose:
   - case sensitive
   - whitespace sensitive
   - quote sensitive

   This file never runs in the browser. It is required by the Express
   server, so the comparison (and the correct answers it compares
   against) stay on the server.
   ========================================================= */

'use strict';

/**
 * Compare one submitted value against the expected answer.
 *
 * This is the single source of truth for answer matching. To change
 * how strict checking is (for example, to ignore surrounding spaces),
 * change ONLY this function.
 *
 * Both sides are coerced to strings first so a number in the JSON
 * (for example 7) and the text a student types ("7") line up. We do
 * NOT trim, lowercase, or otherwise normalize: matching is exact.
 *
 * @param {string|number} expected - the correct answer from the JSON
 * @param {string|number} submitted - what the student sent
 * @returns {boolean} true when they match exactly
 */
function isCorrect(expected, submitted) {
  return String(expected) === String(submitted);
}

/**
 * Score a whole set of submitted answers in one place.
 *
 * Not wired to an endpoint yet. It exists so a FUTURE grade-passback
 * or "save my progress" feature has one function to call, instead of
 * re-implementing scoring next to the network code. Auth and Canvas
 * LTI passback would sit on top of this, not replace it.
 *
 * @param {Array<{expected:(string|number), submitted:(string|number)}>} pairs
 * @returns {{earned:number, possible:number}}
 */
function scorePairs(pairs) {
  let earned = 0;
  for (const pair of pairs) {
    if (isCorrect(pair.expected, pair.submitted)) earned += 1;
  }
  return { earned, possible: pairs.length };
}

module.exports = { isCorrect, scorePairs };
