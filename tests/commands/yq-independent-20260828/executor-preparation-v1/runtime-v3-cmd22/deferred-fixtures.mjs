import assert from 'node:assert/strict';

export function prepareDeferredCase(definition, bases, binding) {
  const fixture = structuredClone(bases[definition.base ?? 'cmd22']);
  fixture.binding = structuredClone(binding);
  fixture.definition = structuredClone(definition);
  const read = fixture.receipt.capture.events.find((event) => event.kind === 'fs-read');
  switch (definition.mutation) {
    case undefined: break;
    case 'literal-observation': read.path = '-name'; break;
    case 'wrong-cwd-observation': read.path = '/other/-name'; break;
    case 'sibling-basename': read.path = '/v/sibling/-name'; break;
    case 'extra-read': fixture.receipt.capture.events.push({ ...read, index: fixture.receipt.capture.events.length }); break;
    case 'missing-read': fixture.receipt.capture.events = fixture.receipt.capture.events.filter((event) => event.kind !== 'fs-read'); break;
    case 'mutated-file-path': fixture.job.files[0].path = './-name'; break;
    case 'mutated-argv-path': fixture.job.argv[4] = '/v/-name'; break;
    case 'missing-reads-binding': delete fixture.job.expected.reads; break;
    case 'missing-binding': fixture.binding = undefined; break;
    case 'wrong-cwd-binding': fixture.binding.profile.cwd = '/other'; break;
    case 'wrong-bytes': fixture.receipt.capture.stdoutHex = '747275650a'; break;
    case 'wrong-status': fixture.receipt.capture.status = 1; break;
    case 'stderr-bytes': fixture.receipt.capture.stderrHex = '78'; break;
    case 'changed-effects': fixture.receipt.capture.effects.after[0].hex = '747275650a'; break;
    case 'extra-operation': fixture.receipt.capture.events.push({ index: fixture.receipt.capture.events.length, kind: 'unbound-fs-operation', method: 'writeFile', path: '/v/-name' }); break;
    case 'wrong-signal': read.signalIsContext = false; break;
    case 'unknown-obligation': fixture.job.expected.assertions = ['UNBOUND_CMD22_SUCCESSOR_OBLIGATION_MUST_STAY_INCOMPLETE']; break;
    default: throw new Error('Unsealed fixture mutation');
  }
  return fixture;
}

export async function runDeferredCase({ fixture, originalAssertCapture, successorAssertCapture, predicate, catalogue, evidence }) {
  const { definition, receipt, job, binding } = fixture;
  assert(['PROJECTION_MATCH', 'RESOLVER_VALUE', 'FAIL', 'INCOMPLETE'].includes(definition.expected), 'Known presealed outcome required');
  assert(['original-v2', 'successor', 'binding-predicate', 'resolver-only'].includes(definition.route), 'Known presealed route required');
  if (definition.route === 'original-v2') assert.equal(typeof originalAssertCapture, 'function');
  if (definition.route === 'successor') assert.equal(typeof successorAssertCapture, 'function');
  if (definition.route === 'binding-predicate') assert.equal(typeof predicate?.assertCmd22ReadPaths, 'function');
  if (definition.route === 'resolver-only') assert.equal(typeof predicate?.resolveFixtureReadOperand, 'function');
  const before = JSON.stringify({ receipt, job, binding });
  let rejection = null;
  let result;
  try {
    if (definition.route === 'original-v2') await originalAssertCapture(receipt, job, evidence, catalogue);
    else if (definition.route === 'successor') await successorAssertCapture(receipt, job, evidence, catalogue);
    else if (definition.route === 'binding-predicate') predicate.assertCmd22ReadPaths(receipt.capture.events.filter((event) => event.kind === 'fs-read'), job, evidence, binding);
    else if (definition.route === 'resolver-only') {
      const profile = definition.missingProfile ? undefined : { ...binding.profile, ...definition.profileChanges };
      result = predicate.resolveFixtureReadOperand(profile, definition.operand);
    } else throw new Error('Unsealed fixture route');
  } catch (error) { rejection = String(error); }
  assert.equal(JSON.stringify({ receipt, job, binding }), before, 'No mutation of bytes/status/input/operation order');
  if (definition.expected === 'PROJECTION_MATCH' || definition.expected === 'RESOLVER_VALUE') {
    assert.equal(rejection, null);
    if (definition.expected === 'RESOLVER_VALUE') assert.equal(result, definition.resolved);
  } else {
    assert.notEqual(rejection, null);
    if (definition.expected === 'INCOMPLETE') assert.match(rejection, /INCOMPLETE_CMD22_PATH_BINDING|UNFULFILLED_OBLIGATIONS/);
  }
  return { id: definition.id, expected: definition.expected, rejection, result, semanticPasses: 0, candidateExecutions: 0 };
}
