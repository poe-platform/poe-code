import assert from 'node:assert/strict';

export const GLOBAL_MILLISECONDS = 1800000;
export const PUBLICATION_MILLISECONDS = 180000;

export function createCoreClock({ started, now }) {
  assert(Number.isFinite(started) && typeof now === 'function');
  let last = started;
  const sample = () => { const value = now(); assert(Number.isFinite(value) && value >= last, 'monotonic clock'); last = value; return value; };
  const deadline = started + GLOBAL_MILLISECONDS;
  return Object.freeze({
    deadline,
    remaining() { return Math.max(0, deadline - sample()); },
    admit({ requiredCaseMilliseconds, cleanupMilliseconds }) {
      for (const value of [requiredCaseMilliseconds, cleanupMilliseconds]) assert(Number.isSafeInteger(value) && value > 0, 'finite required reservation');
      const current = sample();
      const required = requiredCaseMilliseconds + cleanupMilliseconds + PUBLICATION_MILLISECONDS;
      assert(Number.isSafeInteger(required));
      if (required > deadline - current) return Object.freeze({ admitted: false, status: 'UNRUN', reason: 'case+cleanup+publication-do-not-fit', deadline });
      return Object.freeze({ admitted: true, caseDeadline: current + requiredCaseMilliseconds, cleanupDeadline: current + requiredCaseMilliseconds + cleanupMilliseconds, publicationDeadline: deadline });
    },
    assertBeforeDeadline() { assert(sample() <= deadline, 'global 1800-second deadline'); },
  });
}

export async function runCoreSchedule({ cells, started, now, requiredCaseMilliseconds, cleanupMilliseconds, runCase, cleanupCase, publish }) {
  const clock = createCoreClock({ started, now });
  const outcomes = [];
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    const ticket = clock.admit({ requiredCaseMilliseconds: requiredCaseMilliseconds(cell), cleanupMilliseconds: cleanupMilliseconds(cell) });
    if (!ticket.admitted) { for (const remaining of cells.slice(index)) outcomes.push({ id: remaining.id, status: 'UNRUN', reason: ticket.reason }); break; }
    let primaryPresent = false, primary;
    const secondary = [];
    let result;
    try { result = await runCase(cell, ticket); } catch (reason) { primaryPresent = true; primary = reason; }
    try { await cleanupCase(cell, ticket); } catch (reason) { if (!primaryPresent) { primaryPresent = true; primary = reason; } else secondary.push(reason); }
    outcomes.push({ id: cell.id, status: primaryPresent ? 'FAIL' : result.status, primaryPresent, primary, secondary });
    if (primaryPresent) { for (const remaining of cells.slice(index + 1)) outcomes.push({ id: remaining.id, status: 'UNRUN', reason: 'failure-or-uncertain-cleanup' }); break; }
  }
  clock.assertBeforeDeadline();
  await publish({ outcomes, deadline: clock.deadline, publicationReservationMilliseconds: PUBLICATION_MILLISECONDS });
  clock.assertBeforeDeadline();
  return outcomes;
}
