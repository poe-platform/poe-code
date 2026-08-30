import fs from 'node:fs/promises';
import path from 'node:path';
import { demand, exact, relative, ownData, inventory, guard, writeExclusive, regular } from './primitives.mjs';
import { supervise } from './supervisor.mjs';
import { beginBatchPhase, finishBatchPhase } from './batch-phases.mjs';

export function validateCases(manifests, recipe) {
  const fields = ['id', 'entry', 'role', 'rows', 'variants', 'layouts', 'timeoutMs', 'captureBytes', 'workBytes', 'requires'];
  const cases = [];
  const ids = new Set();
  for (const manifest of manifests) {
    demand(manifest.schema === 'm1b-cases-v1' && Array.isArray(manifest.cases), 'CASE_MANIFEST');
    for (const source of manifest.cases) {
      const item = exact(source, fields);
      demand(typeof item.id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(item.id) && !['.', '..'].includes(item.id) && !ids.has(item.id), 'CASE_ID');
      ids.add(item.id);
      relative(item.entry);
      demand(recipe.harness.files.some(row => row.path === item.entry && item.entry.endsWith('.mjs')), 'CASE_ENTRY_CLOSURE');
      demand(['STOCK', 'MECHANICAL', 'LOADED', 'TYPE', 'SOURCE_ONLY', 'UNRUN'].includes(item.role), 'CASE_ROLE');
      for (const field of ['rows', 'variants', 'layouts', 'requires']) demand(Array.isArray(item[field]) && [...item[field]].every(value => typeof value === 'string'), 'CASE_ARRAY');
      demand([...item.layouts].every(layout => ['S', 'M'].includes(layout)) && new Set(item.layouts).size === item.layouts.length, 'CASE_LAYOUTS');
      demand(Number.isSafeInteger(item.timeoutMs) && item.timeoutMs > 0 && item.timeoutMs <= 30000, 'CASE_TIMEOUT');
      demand(Number.isSafeInteger(item.captureBytes) && item.captureBytes > 0 && item.captureBytes <= 4194304, 'CASE_CAPTURE');
      demand(Number.isSafeInteger(item.workBytes) && item.workBytes >= 0 && item.workBytes <= 402653184, 'CASE_WORK');
      cases.push(JSON.parse(JSON.stringify(item)));
    }
  }
  const batches = recipe.batches;
  const enrolled = new Set();
  for (const batch of batches) {
    exact(batch, ['id', 'layout', 'phase', 'ids', 'timeoutMs', 'streamBytes', 'mutant', 'control']);
    demand(typeof batch.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(batch.id) && ['stock', 'mechanical', 'types', 'loaded'].includes(batch.phase), 'BATCH_ID_PHASE');
    demand(Number.isSafeInteger(batch.streamBytes) && batch.streamBytes > 0 && batch.streamBytes <= 524288, 'BATCH_STREAM_CAP');
    demand(['S', 'M'].includes(batch.layout) && batch.ids.length > 0 && batch.ids.length <= 16, 'BATCH_SHAPE');
    if (batch.control !== null) {
      if (batch.control.stage === 'STOCK') {
        exact(batch.control, ['stage', 'members']);
        demand(Array.isArray(batch.control.members) && batch.control.members.length === batch.ids.length, 'STOCK_CONTROL_MEMBERS');
        for (const member of batch.control.members) {
          exact(member, ['group', 'caseId']);
          demand(recipe.mutants.some(row => row.id === member.group) && batch.ids.includes(member.caseId), 'STOCK_CONTROL_BINDING');
        }
      } else {
        exact(batch.control, ['stage', 'group']);
        demand(['MUTANT', 'RESTORE'].includes(batch.control.stage) && batch.ids.length === 1 && recipe.mutants.some(row => row.id === batch.control.group), 'CONTROL_BINDING');
      }
    }
    let cumulative = 0;
    for (const id of batch.ids) {
      const item = cases.find(row => row.id === id);
      demand(item && item.layouts.includes(batch.layout) && !['SOURCE_ONLY', 'UNRUN'].includes(item.role), 'BATCH_MEMBER');
      demand(!enrolled.has(`${batch.layout}:${id}`), 'BATCH_DUPLICATE');
      enrolled.add(`${batch.layout}:${id}`);
      cumulative += item.timeoutMs;
    }
    demand(Number.isSafeInteger(batch.timeoutMs) && batch.timeoutMs > 0 && batch.timeoutMs <= cumulative && batch.timeoutMs <= 30000, 'BATCH_DEADLINE');
  }
  for (const item of cases.filter(row => !['SOURCE_ONLY', 'UNRUN'].includes(row.role))) for (const layout of item.layouts) demand(enrolled.has(`${layout}:${item.id}`), 'CASE_UNSCHEDULED');
  const compilerCalls = cases.filter(row => row.role === 'TYPE').reduce((sum, row) => sum + row.layouts.length, 0);
  demand(compilerCalls === 9 && 5 + batches.length + compilerCalls <= 168, 'ALL_NESTED_STARTS');
  return { cases, plannedChildStarts: 4 + batches.length + compilerCalls, compilerCalls };
}
export async function runBatch(state, batch, items, candidateRoot, compile) {
  const { budget, recipe, root, harnessRoot } = state;
  const caseBase = path.join(root, 'cases', batch.id);
  const workGrant = items.reduce((sum, item) => sum + item.workBytes, 0);
  budget.reserveWork(workGrant);
  await fs.mkdir(caseBase, { recursive: true, mode: 0o700 });
  const candidateBefore = await inventory(candidateRoot);
  const harnessBefore = await inventory(harnessRoot);
  const binding = { builtins: recipe.loader.builtins, files: [...candidateBefore.filter(row => row.kind === 'file' && row.path.endsWith('.js')).map(row => ({ ...row, absolute: path.join(candidateRoot, row.path) })), ...harnessBefore.filter(row => row.kind === 'file' && row.path.endsWith('.mjs')).map(row => ({ ...row, absolute: path.join(harnessRoot, row.path) }))] };
  const jobFile = path.join(root, 'control', `${batch.id}-job.json`);
  const bindingFile = path.join(root, 'control', `${batch.id}-load.json`);
  let controlBytes = 0;
  const writeControl = async (filename, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    controlBytes += bytes.length;
    demand(controlBytes <= 131072, 'JOB_AND_LOAD_CONTROL_BYTES');
    budget.reserveCapture(bytes.length);
    await writeExclusive(filename, bytes);
    return regular(filename);
  };
  const jobHash = await writeControl(jobFile, { cases: items, layout: batch.layout, candidateRoot, caseBase, harnessRoot });
  const bindingHash = await writeControl(bindingFile, binding);
  const controlRoot = path.join(root, 'control');
  const controlsBefore = await inventory(controlRoot);
  const checkInputs = async () => {
    await guard(candidateRoot, candidateBefore);
    await guard(harnessRoot, harnessBefore);
    await guard(controlRoot, controlsBefore);
    await regular(jobFile, jobHash);
    await regular(bindingFile, bindingHash);
    await state.verifyProjection();
  };
  const completed = [];
  let active = null;
  let ended = false;
  let lastSequence = 0;
  let captures = 0;
  let capturedBytes = 0;
  let compiled = false;
  let caseStream;
  let framingBytes = 0;
  const deadline = state.batchDeadline;
  budget.admit(deadline);
  const child = await supervise(budget, { id: batch.id, executable: state.node, argv: ['--experimental-loader', path.join(harnessRoot, 'runner/loader.mjs'), path.join(harnessRoot, 'runner/worker.mjs')], cwd: caseBase, env: { ...state.env, M1B_JOB: jobFile, M1B_JOB_BYTES: String(jobHash.bytes), M1B_JOB_SHA256: jobHash.sha256, M1B_LOAD_BINDING: bindingFile, M1B_LOAD_BINDING_BYTES: String(bindingHash.bytes), M1B_LOAD_BINDING_SHA256: bindingHash.sha256 }, streamBytes: batch.streamBytes, deadline }, async (message, record, clocks) => {
    const frame = exact(message, ['sequence', 'type', 'value']);
    demand(frame.sequence === ++lastSequence && !ended, 'RPC_SEQUENCE');
    let value = null;
    if (frame.type === 'CASE_BEGIN') {
      const body = exact(frame.value, ['caseId']);
      demand(active === null && items[completed.length]?.id === body.caseId, 'CASE_SEQUENCE');
      await checkInputs();
      active = items[completed.length];
      captures = 0;
      capturedBytes = 0;
      compiled = false;
      framingBytes = 0;
      caseStream = await budget.stream(`${batch.id}-case-${completed.length}.frames.bin`);
      const deadlineOffsetMs = clocks.beginCase(active.timeoutMs);
      await budget.record(`${batch.id}-case-begin`, { caseId: active.id, parentElapsedMs: budget.elapsed(), deadlineOffsetMs, capturePath: caseStream.path });
    } else if (frame.type === 'CAPTURE') {
      const body = exact(frame.value, ['caseId', 'label', 'encoding', 'data']);
      demand(active?.id === body.caseId && typeof body.label === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(body.label), 'CAPTURE_CASE');
      demand(body.encoding === 'json' || body.encoding === 'base64' || body.encoding === 'json-utf8-fragment', 'CAPTURE_ENCODING');
      let bytes;
      if (body.encoding !== 'json') {
        demand(typeof body.data === 'string', 'CAPTURE_BASE64_TYPE');
        bytes = Buffer.from(body.data, 'base64');
        demand(bytes.toString('base64') === body.data, 'CAPTURE_BASE64_CANONICAL');
      } else bytes = Buffer.from(JSON.stringify(ownData(body.data)));
      capturedBytes += bytes.length;
      demand(capturedBytes <= active.captureBytes, 'CAPTURE_CASE_LIMIT');
      const headerText = JSON.stringify({ label: body.label, encoding: body.encoding, bytes: bytes.length });
      demand(Buffer.byteLength(headerText) <= 256 && captures < 576, 'CAPTURE_FRAME_HEADER');
      framingBytes += Buffer.byteLength(headerText) + 4;
      demand(framingBytes <= 65536, 'CASE_FRAMING_BYTES');
      const header = Buffer.from(headerText);
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(header.length);
      await caseStream.append(prefix);
      await caseStream.append(header);
      await caseStream.append(bytes);
      await caseStream.flush();
      captures++;
    } else if (frame.type === 'COMPILE') {
      const body = exact(frame.value, ['caseId', 'fixtureId']);
      demand(active?.id === body.caseId && active.role === 'TYPE' && !compiled && active.requires.includes(body.fixtureId), 'COMPILE_CASE');
      compiled = true;
      value = await compile(body.fixtureId, candidateRoot, active, clocks.deadline(), path.join(caseBase, active.id), batch.layout);
      captures++;
    } else if (frame.type === 'CASE_END') {
      const body = exact(frame.value, ['caseId', 'status', 'captured', 'rawBytes', 'assertions', 'cleanupFailed', 'escaped', 'thrownType', 'aborted']);
      demand(active?.id === body.caseId && ['PASS', 'FAIL', 'INCOMPLETE'].includes(body.status), 'CASE_RECEIPT');
      demand(Array.isArray(body.assertions) && body.assertions.length <= 4096 && typeof body.cleanupFailed === 'boolean' && typeof body.escaped === 'boolean' && typeof body.aborted === 'boolean', 'ASSERTION_RECEIPT');
      for (const assertion of body.assertions) {
        const row = exact(assertion, ['label', 'passed', 'details']);
        demand(typeof row.label === 'string' && typeof row.passed === 'boolean', 'ASSERTION_TYPE');
      }
      const actualStatus = body.cleanupFailed || body.escaped || body.aborted || [...body.assertions].some(row => !row.passed) ? 'FAIL' : body.assertions.length === 0 ? 'INCOMPLETE' : 'PASS';
      demand(actualStatus === body.status && (body.assertions.length === 0 || captures > 0), 'ASSERTION_STATUS');
      const captureReference = await caseStream.close();
      caseStream = undefined;
      const receipt = { ...body, parentElapsedMs: budget.elapsed(), captures, framingBytes, captureReference };
      demand(Buffer.byteLength(JSON.stringify(receipt)) <= 65536, 'CASE_METADATA_BOUND');
      await budget.record(`${batch.id}-case-end`, receipt);
      if (body.status !== 'PASS') budget.fail(`${batch.id}:${body.caseId}:${body.status}`);
      if (body.cleanupFailed) budget.fail(`${batch.id}:${body.caseId}:UNKNOWN_COOPERATIVE_CLEANUP`, true);
      if (body.escaped) budget.fail(`${batch.id}:${body.caseId}:ESCAPING_SETUP_OR_ACTOR_FAILURE`, true);
      if (body.aborted) budget.fail(`${batch.id}:${body.caseId}:ABORTED_CASE`, true);
      await checkInputs();
      demand(budget.unsafe === null, 'UNSAFE_CASE_CANNOT_CONTINUE');
      budget.admit(clocks.deadline());
      const finishedRoot = path.join(caseBase, body.caseId);
      await guard(finishedRoot, state.typeCaseRows.get(finishedRoot) ?? [], { rootMode: 0o700 });
      completed.push({ id: body.caseId, status: body.status });
      active = null;
      clocks.endCase();
    } else if (frame.type === 'BATCH_END') {
      const body = exact(frame.value, ['failed']);
      demand(active === null && typeof body.failed === 'boolean' && body.failed === completed.some(row => row.status !== 'PASS'), 'BATCH_STATUS');
      demand(completed.length === items.length, 'BATCH_MISSING_CASE');
      ended = true;
    } else throw new Error('UNKNOWN_RPC');
    return { sequence: frame.sequence, type: 'ACK', value };
  });
  await finishBatchPhase(state, child.code === 0 && !child.timedOut && child.closed ? 'PASS' : 'FAIL', child.code === 0 ? null : 'BODY_WORKER_NONZERO');
  await beginBatchPhase(state, batch, 'VERIFY');
  await guard(candidateRoot, candidateBefore);
  await guard(harnessRoot, harnessBefore);
  await regular(jobFile, jobHash);
  await regular(bindingFile, bindingHash);
  await guard(controlRoot, controlsBefore);
  await state.verifyProjection();
  if (!ended || active !== null) budget.fail(`${batch.id}:MISSING_TERMINAL_RECEIPT`, true);
  const caseAfter = await inventory(caseBase, { maxBytes: workGrant });
  demand(caseAfter.filter(row => row.kind === 'file').reduce((sum, row) => sum + row.bytes, 0) <= workGrant, 'CASE_WORK_LIMIT');
  demand(child.closed && budget.active.size === 0 && budget.unsafe === null, 'RETIREMENT_BARRIER');
  await fs.rm(caseBase, { recursive: true });
  demand(await fs.lstat(caseBase).then(() => false, error => error.code === 'ENOENT'), 'CASE_DELETE_BARRIER');
  budget.releaseDeletedWork(workGrant);
  demand(budget.now() <= state.verificationDeadline, 'VERIFICATION_GUARD_DELETE_DEADLINE');
  return { batch: batch.id, layout: batch.layout, child: { id: child.id, code: child.code, signal: child.signal, closed: child.closed, timedOut: child.timedOut, receipt: child.receipt, raw: child.raw }, completed, unrun: items.slice(completed.length).map(item => item.id) };
}
