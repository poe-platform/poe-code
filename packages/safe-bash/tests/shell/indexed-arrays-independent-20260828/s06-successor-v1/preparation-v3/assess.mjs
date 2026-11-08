import { classify } from '../../executor-v1/supervisor.mjs';

export function assess(run, ids, loads, mutant) {
  const verdict = classify(run, ids, { loads });
  if (!mutant) return verdict;
  const loaded = verdict.loads.some(row => row.path === mutant.path && row.sha256 === mutant.sha256);
  const activated = verdict.activations.some(row => row.id === mutant.id && row.path === mutant.path && row.sha256 === mutant.sha256 && Number.isSafeInteger(row.hits) && row.hits > 0);
  if (!loaded || !activated) { verdict.coherent = false; verdict.errors.push('mutant not actually loaded and activated'); }
  const rejected = mutant.requiredFailed.length > 0 && mutant.requiredFailed.every(id => verdict.failed.includes(id));
  const companions = mutant.requiredPassed.every(id => verdict.observations.some(row => row.id === id && row.pass));
  verdict.mutantKilled = verdict.coherent && rejected && companions;
  verdict.survivedOrCompanionFailed = verdict.coherent && !verdict.mutantKilled;
  return verdict;
}
