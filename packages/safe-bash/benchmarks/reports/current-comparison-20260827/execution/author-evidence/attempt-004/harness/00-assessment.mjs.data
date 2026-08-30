import { compare } from './reuse/expanded-common.mjs';
import { assess } from './reuse/breadth-assess.mjs';

export function assessAttempt(request, attempt) {
  const lifecycle = attempt.clean === true;
  if (request.profile === 'breadth') {
    const report = attempt.result?.report;
    const capture = { report, parentTimeout: attempt.failures.some(reason => /deadline|timeout/u.test(reason)), exitCode: attempt.engineExit?.code, signal: attempt.engineExit?.signal };
    const historical = assess(request.specimen, capture);
    const cleanupError = Boolean(report?.cleanup?.error);
    return { historical, lifecycle, cleanupError, operationalCredit: lifecycle && !cleanupError && historical.operationalCredit, status: !lifecycle || cleanupError ? 'lifecycle-or-capture-failure' : historical.classification };
  }
  const observation = attempt.result?.observation;
  const comparison = observation ? compare(request.expected, observation) : null;
  return { comparison, lifecycle, status: request.expected?.oracleValid === false ? 'invalid-oracle' : !lifecycle ? 'lifecycle-or-capture-failure' : attempt.result?.error ? 'harness-or-engine-error' : comparison?.pass ? 'pass' : 'fail' };
}
