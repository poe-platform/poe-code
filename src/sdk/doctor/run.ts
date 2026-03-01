import type {
  DoctorCheck,
  DoctorContext,
  DoctorResult,
  CheckResult
} from "./types.js";

export async function runChecks(
  checks: DoctorCheck[],
  baseContext: DoctorContext
): Promise<DoctorResult> {
  const previousResults = new Map<string, CheckResult>(
    baseContext.previousResults
  );
  const results: Array<{ check: DoctorCheck; result: CheckResult }> = [];
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };

  for (const check of checks) {
    const ctx: DoctorContext = { ...baseContext, previousResults };
    const result = await check.run(ctx);
    previousResults.set(check.id, result);
    results.push({ check, result });
    summary[result.status] += 1;
  }

  return { checks: results, summary };
}
