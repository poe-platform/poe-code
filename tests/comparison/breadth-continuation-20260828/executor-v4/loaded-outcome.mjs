import { assessWorkflow } from './predicates.mjs';
import { relativeName, requireThat, hash } from './safety.mjs';

export function assessLoadedNoop(specimen, before, observed, sources) {
  requireThat(observed?.evaluated === true && Array.isArray(sources) && sources.some(source => source.kind === 'nextLoad' && source.sha256 === observed.entrySha256), 'C12_LOAD_BINDING', observed);
  const result = observed.observation;
  requireThat(result && Number.isInteger(result.exitCode) && result.exitCode >= 0 && result.exitCode <= 255 && result.files && typeof result.files === 'object' && !Array.isArray(result.files), 'C12_OUTCOME_SCHEMA', result);
  requireThat(Object.keys(result.files).length <= 64, 'C12_EFFECT_CAP', result.files);
  const entries = new Map(before.entries.map(entry => [entry.path, structuredClone(entry)]));
  let total = 0;
  for (const [name, effect] of Object.entries(result.files)) {
    relativeName(name);
    requireThat(effect && typeof effect.base64 === 'string', 'C12_EFFECT_SCHEMA', name);
    const bytes = Buffer.from(effect.base64, 'base64');
    total += bytes.length;
    requireThat(bytes.toString('base64') === effect.base64 && total <= 65536, 'C12_EFFECT_BYTES', name);
    entries.set(`/fixture/${name}`, { path: `/fixture/${name}`, type: 'file', mode: effect.mode ?? 0o666, base64: effect.base64, size: bytes.length });
  }
  const report = { captureErrors: [], before, after: { complete: true, entries: [...entries.values()] }, result: { exitCode: result.exitCode, stdoutBase64: result.stdoutBase64 ?? '', stderrBase64: result.stderrBase64 ?? '' }, additionalObservations: {} };
  const assessment = assessWorkflow(specimen, report, 'virtual-bash');
  const designated = assessment.checks.find(check => check.id === 'ADDED:part-aa');
  return { pass: result.exitCode === 0 && Object.keys(result.files).length === 0 && assessment.checks.find(check => check.id === 'STATUS')?.pass === true && designated?.pass === false, report, assessment, loadedObservationSha256: hash(JSON.stringify(result)), actualStatus: result.exitCode, actualEffects: result.files, designatedPredicate: 'ADDED:part-aa' };
}
