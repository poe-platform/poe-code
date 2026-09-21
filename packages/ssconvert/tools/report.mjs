// Explicit evidence aggregation, outside default unit discovery.
import { readFileSync, writeFileSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { compareCapture, coverageGate } from '../dist/canonical/gates.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => { const bytes = readFileSync(path); return { value: JSON.parse(bytes), hash: hash(bytes) }; };
function sameFile(left, right) {
  const leftPath = realpathSync(left), rightPath = realpathSync(right);
  const a = lstatSync(leftPath), b = lstatSync(rightPath);
  return leftPath === rightPath || a.dev === b.dev && a.ino === b.ino;
}
const [casesPath, outputPath, registerPath = 'docs/ssconvert/canonical-differential-register.json'] = process.argv.slice(2);
if (!casesPath || !outputPath) throw new Error('Usage: node report.mjs out/CASES.json out/REPORT.json [REGISTER.json]');
const out = realpathSync('out'), output = resolve(outputPath);
if (!realpathSync(dirname(output)).startsWith(out + '/') && realpathSync(dirname(output)) !== out) throw new Error('Reports must be under out');
const register = read(registerPath);
for (const binding of [register.value.census, register.value.profile]) if (hash(readFileSync(binding.path)) !== binding.sha256) throw new Error('Register binding drift: ' + binding.path);
const profile = read(register.value.profile.path).value;
const digestIdentity = value => typeof value === 'string' && value.length === 64 && [...value].every(char => '0123456789abcdef'.includes(char));
const members = value => Array.isArray(value) && value.length > 0 && value.every(item => item &&
  typeof item.path === 'string' && item.path.length > 0 && digestIdentity(item.sha256));
const qualifiedProfile = profile.status === 'captured' && profile.sourceHash === register.value.source.sha256 &&
  digestIdentity(profile.executableHash) && members(profile.dependencies) && members(profile.plugins) && profile.locale;
const cases = read(casesPath), evidence = [], details = [];
for (const item of cases.value) {
  const feature = register.value.entries.find(entry => entry.id === item.feature);
  if (!feature) throw new Error('Foreign feature: ' + item.feature);
  try {
    if (!qualifiedProfile) throw new Error('Blocked oracle: frozen dependency/plugin/locale profile is not captured');
    const reference = read(item.reference);
    if (reference.value.state !== 'captured') throw new Error('Blocked oracle: ' + reference.value.reason);
    if (sameFile(item.reference, item.candidate)) throw new Error('Independent command captures required');
    const candidate = read(item.candidate);
    if (candidate.value.state !== 'captured') throw new Error('Blocked candidate: ' + candidate.value.reason);
    for (const capture of [reference.value, candidate.value]) {
      const inputHash = hash(JSON.stringify({ ...(Object.hasOwn(capture, 'argv0') ? { argv0: capture.argv0 } : {}),
        argv: capture.argv, stdin: capture.stdin, env: capture.env, cwd: '/', before: capture.before }));
      if (capture.inputHash !== inputHash) throw new Error('Capture input receipt does not authenticate invocation/namespace');
    }
    if (reference.value.sourceHash !== register.value.source.sha256 || reference.value.profileHash !== register.value.profile.sha256)
      throw new Error('Capture profile/source differs from frozen register');
    const differences = compareCapture(reference.value, candidate.value);
    const checks = { exact: differences.length === 0 }, artifacts = [];
    for (const requirement of feature.requirements.filter(name => name !== 'exact')) {
      const pair = item.checks?.[requirement];
      if (!pair) continue;
      if (sameFile(pair.reference, pair.candidate)) throw new Error('Independent artifacts required: ' + requirement);
      const left = read(pair.reference), right = read(pair.candidate);
      const equal = isDeepStrictEqual(left.value, right.value);
      const procedural = ['roundTrip', 'interoperability'].includes(requirement);
      // Equal snapshots cannot prove that the required sequence of tools ran.
      // Preserve mismatches, but leave procedure qualification unmeasured.
      if (!procedural || !equal) checks[requirement] = equal;
      artifacts.push({ requirement, referenceHash: left.hash, candidateHash: right.hash, equal,
        qualification: procedural ? 'unmeasured-procedure' : 'artifact-comparison' });
    }
    const mismatch = differences.length > 0 || Object.values(checks).some(value => value !== true);
    evidence.push({ feature: item.feature, state: mismatch ? 'mismatched' : 'passed', exact: checks.exact,
      semantic: checks.semantic, roundTrip: checks.roundTrip, interoperability: checks.interoperability, checks,
      receipts: { sourceHash: reference.value.sourceHash, profileHash: reference.value.profileHash,
        inputHash: reference.value.inputHash, referenceHash: reference.hash, candidateHash: candidate.hash } });
    details.push({ feature: item.feature, differences, artifacts });
  } catch (error) {
    evidence.push({ feature: item.feature, state: 'blocked', reason: String(error) });
    details.push({ feature: item.feature, blocker: String(error) });
  }
}
const result = coverageGate(register.value.entries, evidence);
writeFileSync(output, JSON.stringify({ registerHash: register.hash, casesHash: cases.hash, ...result, evidence, details, normalizations: [] }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: result.pass, denominator: result.denominator, passed: result.passed,
  missing: result.missing.length, blocked: result.blocked.length, mismatched: result.mismatched.length }));
process.exitCode = result.pass ? 0 : 1;
