import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createExecutionClient, type MaterializationStatus, type NativeInvocation, type NativeJob } from './materializations.js';
import type { DependencyMaterializeRequest } from './protocol.js';

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));
function ready(): MaterializationStatus {
  return { operationId: 'op', manifestId: 'manifest', manifestRevision: 'revision', directoryRevision: 'tree', state: 'ready', logicalRoot: bytes('/work'), cwd: bytes('/work'), entries: [{ index: 0, state: 'applied', revision: 'entry' }], callbackGrantIds: [] };
}
function client(value: unknown) {
  return createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async () => Response.json(value, { headers: { 'Execution-Epoch': 'e', 'Execution-Profile': 'dependency-manifest-v1' } }) });
}

it.each(['sessionId', 'epoch', 'materializationId', 'cwd', 'originalArgv'] as const)(
  'rejects an inadmissible job %s before acquiring credentials or submitting', async field => {
    const invocation = structuredClone(exitedJob().invocation);
    if (field === 'cwd') invocation.cwd = bytes('relative');
    else if (field === 'originalArgv') invocation.originalArgv = [[0]];
    else invocation[field] = field === 'materializationId' ? '' : 'foreign';
    const token = vi.fn(() => 'token');
    const fetch = vi.fn(async () => Response.json(exitedJob(), { headers: { 'Execution-Epoch': 'e' } }));
    const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token, fetch });
    await expect(control.execute(invocation)).rejects.toBeInstanceOf(TypeError);
    expect(token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(['manifestId', 'manifestRevision', 'directoryRevision'] as const)(
  'rejects a job contradicting the observed materialization %s before submission', async field => {
    const fetch = vi.fn(async () => Response.json(ready(), { headers: { 'Execution-Epoch': 'e' } }));
    const token = vi.fn(() => 'token');
    const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token, fetch });
    await control.inspectMaterialization('op');
    fetch.mockClear(); token.mockClear();
    const invocation = { ...exitedJob().invocation, materializationId: 'op',
      manifestId: 'manifest', manifestRevision: 'revision', directoryRevision: 'tree', [field]: 'stale' };
    await expect(control.execute(invocation)).rejects.toThrow('Native job identity mismatch');
    expect(token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(['materialize', 'inspect', 'list'] as const)('rejects an out-of-root cwd in the first %s observation', async operation => {
  for (const cwd of ['/elsewhere', '/work-other/edit']) {
    const status = { ...ready(), cwd: bytes(cwd) };
    const control = client(operation === 'list' ? [status] : status);
    const pending = operation === 'materialize'
      ? control.materialize({ sessionId: 's', epoch: 'e', manifestId: 'manifest', manifestRevision: 'revision', bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'key' })
      : operation === 'inspect' ? control.inspectMaterialization('op') : control.listMaterializations();
    await expect(pending).rejects.toThrow('Invalid materialization status');
  }
});

it('preserves in-root symlink-relative cwd components during inspection', async () => {
  const status = { ...ready(), cwd: bytes('/work/shortcut/../edit') };
  expect(await client(status).inspectMaterialization('op')).toEqual(status);
});

it.each(['materialize', 'inspect', 'list'] as const)('rejects competing readiness identities in %s responses', async operation => {
  const status = { ...ready(), readiness: [
    { kind: 'required', identity: 'tree', state: 'complete' },
    { kind: 'speculative', identity: 'tree', state: 'failed' },
  ] };
  const control = client(operation === 'list' ? [status] : status);
  const pending = operation === 'materialize'
    ? control.materialize({ sessionId: 's', epoch: 'e', manifestId: 'manifest', manifestRevision: 'revision',
      bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'key' })
    : operation === 'inspect' ? control.inspectMaterialization('op') : control.listMaterializations();
  await expect(pending).rejects.toThrow('Invalid materialization status');
});

it('keeps control admission bound to its original session and epoch while awaiting credentials', async () => {
  let release!: (token: string) => void;
  const token = new Promise<string>(resolve => { release = resolve; });
  const options = { baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => token,
    fetch: async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(url)).toContain('/sessions/s/');
      expect(new Headers(init?.headers).get('Execution-Epoch')).toBe('e');
      return Response.json(ready(), { headers: { 'Execution-Epoch': 'e' } });
    },
  };
  const control = createExecutionClient(options);
  const pending = control.inspectMaterialization('op');
  options.sessionId = 'other-session'; options.epoch = 'other-epoch';
  release('token');
  await expect(pending).resolves.toEqual(ready());
});

it.each(['materialize', 'execute'] as const)('pins %s admission before credentials and acknowledgement arrive', async operation => {
  const materialization: DependencyMaterializeRequest = { sessionId: 's', epoch: 'e', manifestId: 'manifest', manifestRevision: 'revision', bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'key' };
  const invocation: NativeInvocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'authority', bindingId: 'binding', materializationId: 'op', manifestId: 'manifest', manifestRevision: 'revision', directoryRevision: 'tree', cwd: bytes('/work'), originalArgv: [bytes('native'), bytes('edit/lists/cut.ffconcat'), []] };
  const input = operation === 'materialize' ? materialization : invocation;
  const original = structuredClone(input);
  let credentials!: (value: string) => void;
  let acknowledge!: (value: Response) => void;
  let sent!: () => void;
  const sentRequest = new Promise<void>(resolve => { sent = resolve; });
  const token = new Promise<string>(resolve => { credentials = resolve; });
  let submitted: unknown;
  const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => token, fetch: async (_url, init) => {
    submitted = JSON.parse(init!.body as string);
    sent();
    return new Promise<Response>(resolve => { acknowledge = resolve; });
  } });
  const pending = operation === 'materialize' ? control.materialize(materialization) : control.execute(invocation);
  input.manifestId = 'credential-time-replacement';
  invocation.cwd.push(47, 120);
  invocation.originalArgv[1].push(120);
  credentials('token');
  await sentRequest;
  input.manifestId = 'acknowledgement-time-replacement';
  input.manifestRevision = 'another-revision';
  const response = operation === 'materialize' ? ready() : { invocation: original, jobId: 'job', materializationId: 'op', directoryRevision: 'tree', state: 'exited', result: { exitCode: 0, stdout: [], stderr: [] } };
  acknowledge(Response.json(response, { headers: { 'Execution-Epoch': 'e' } }));
  const observed = await pending;
  expect(submitted).toEqual(original);
  expect(observed).toEqual(response);
});

it.each([
  { directoryRevision: null },
  { entries: [{ index: 0, state: 'pending', revision: null }] },
  { entries: [{ index: 1, state: 'applied', revision: 'entry' }] },
  { entries: [{ index: 0, state: 'applied', revision: null }] },
  { operationId: 'another-operation' },
  { logicalRoot: [47, 0] },
  { callbackGrantIds: ['grant', 'grant'] },
  { state: 'invented' },
])('rejects contradictory or malformed materialization inspections %j', async change => {
  await expect(client({ ...ready(), ...change }).inspectMaterialization('op')).rejects.toBeInstanceOf(TypeError);
});

it.each(['materialize', 'inspect', 'list'] as const)('enforces shared preparation errors in %s responses', async operation => {
  const status = { ...ready(), state: 'failed', error: 'native-command-error', failureCategory: 'readiness' };
  const control = client(operation === 'list' ? [status] : status);
  const pending = operation === 'materialize'
    ? control.materialize({ sessionId: 's', epoch: 'e', manifestId: 'manifest', manifestRevision: 'revision',
      bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'key' })
    : operation === 'inspect' ? control.inspectMaterialization('op') : control.listMaterializations();
  await expect(pending).rejects.toBeInstanceOf(TypeError);
});

it('rejects extra entry fields outside the shared inspection contract', async () => {
  const status = { ...ready(), entries: [{ ...ready().entries[0], destination: '/canonical/output' }] };
  await expect(client(status).inspectMaterialization('op')).rejects.toBeInstanceOf(TypeError);
});

it('validates every record in a materialization listing', async () => {
  await expect(client([ready(), { ...ready(), entries: [] , directoryRevision: null }]).listMaterializations()).rejects.toBeInstanceOf(TypeError);
  expect(await client([ready()]).listMaterializations()).toEqual([ready()]);
});

it('retains partial progress without repairing it into a ready tree', async () => {
  const partial = { ...ready(), state: 'partial', error: 'wrong-hash', failureCategory: 'integrity', entries: [{ index: 0, state: 'applied', revision: 'entry' }, { index: 1, state: 'failed', revision: null, error: 'wrong-hash' }, { index: 2, state: 'pending', revision: null }] };
  expect(await client(partial).inspectMaterialization('op')).toEqual(partial);
});

it('rejects a shortened status for a manifest observed by this client', async () => {
  const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async (input, init) => {
    const value = String(input).endsWith('/manifests')
      ? { manifestId: 'manifest', revision: 'revision', sha256: createHash('sha256').update(init!.body as string).digest('hex') }
      : { ...ready(), entries: [] };
    return Response.json(value, { headers: { 'Execution-Epoch': 'e' } });
  } });
  await control.putManifest({ version: 1, sessionId: 's', epoch: 'e', namespaceId: 'n', revision: 'revision', logicalRoot: bytes('/work'), cwd: bytes('/work'), sourceAuthorityId: 'authority', entries: [{ kind: 'directory', path: [bytes('empty')], source: { authorityId: 'authority', path: bytes('/source/empty'), freshness: 'immutable', snapshotId: 'upload', observedVersion: null, retainedIdentity: null } }] });
  await expect(control.inspectMaterialization('op')).rejects.toThrow('Incomplete materialization status');
});

it.each(['materialize', 'inspect', 'list'] as const)('binds the first %s response to the stored manifest root and cwd', async operation => {
  for (const change of [{ logicalRoot: bytes('/elsewhere'), cwd: bytes('/elsewhere') }, { cwd: bytes('/work/edit') }, { manifestRevision: 'different' }]) {
    const manifest = { version: 1 as const, sessionId: 's', epoch: 'e', namespaceId: 'n', revision: 'revision', logicalRoot: bytes('/work'), cwd: bytes('/work'), sourceAuthorityId: 'authority', entries: [] };
    const status = { ...ready(), entries: [], ...change };
    const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async (url, init) => {
      const value = String(url).endsWith('/manifests')
        ? { manifestId: 'manifest', revision: 'revision', sha256: createHash('sha256').update(init!.body as string).digest('hex') }
        : operation === 'list' && init?.method === 'GET' ? [status] : status;
      return Response.json(value, { headers: { 'Execution-Epoch': 'e' } });
    } });
    await control.putManifest(manifest);
    const result = operation === 'materialize'
      ? control.materialize({ sessionId: 's', epoch: 'e', manifestId: 'manifest', manifestRevision: 'revision', bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'key' })
      : operation === 'inspect' ? control.inspectMaterialization('op') : control.listMaterializations();
    await expect(result).rejects.toThrow('Manifest identity mismatch');
  }
});

it('owns submitted manifest identity while awaiting credentials and after returning inspection', async () => {
  const manifest = { version: 1 as const, sessionId: 's', epoch: 'e', namespaceId: 'n', revision: 'revision', logicalRoot: bytes('/work'), cwd: bytes('/work'), sourceAuthorityId: 'authority', entries: [] };
  const original = structuredClone(manifest);
  let release!: (token: string) => void;
  const credential = new Promise<string>(resolve => { release = resolve; });
  const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => credential, fetch: async (url, init) => {
    if (String(url).endsWith('/manifests')) expect(JSON.parse(init!.body as string)).toEqual(original);
    const value = String(url).endsWith('/manifests')
      ? { manifestId: 'manifest', revision: 'revision', sha256: createHash('sha256').update(init!.body as string).digest('hex') }
      : String(url).endsWith('/manifests/manifest') ? original : { ...ready(), entries: [] };
    return Response.json(value, { headers: { 'Execution-Epoch': 'e' } });
  } });
  const submission = control.putManifest(manifest);
  manifest.logicalRoot.push(47, 120);
  manifest.cwd.push(47, 120);
  manifest.revision = 'mutated';
  release('token');
  await submission;
  expect(await control.inspectMaterialization('op')).toEqual({ ...ready(), entries: [] });
  const inspected = await control.inspectManifest('manifest');
  inspected.cwd.push(47, 120);
  inspected.logicalRoot.push(47, 120);
  inspected.revision = 'mutated';
  expect(await control.inspectMaterialization('op')).toEqual({ ...ready(), entries: [] });
});

it.each([
  [{ kind: 'required', identity: 'tree', state: 'failed' }],
  [{ kind: 'required', identity: 'tree', state: 'pending' }],
  [{ kind: 'speculative', identity: 'late-font', state: 'complete' }],
  [{ kind: 'required', identity: '', state: 'complete' }],
  [{ kind: 'required', identity: 'tree', state: 'invented' }],
  null,
])('rejects initial materialization with invalid required readiness %j', async readiness => {
  await expect(client({ ...ready(), readiness }).materialize({ sessionId: 's', epoch: 'e', manifestId: 'manifest', manifestRevision: 'revision', bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'key' })).rejects.toBeInstanceOf(TypeError);
});

it('keeps speculative failures advisory in a ready inspection', async () => {
  const status = { ...ready(), readiness: [
    { kind: 'required', identity: 'tree', state: 'complete' },
    { kind: 'speculative', identity: 'late-font', state: 'failed' },
  ] };
  expect(await client(status).inspectMaterialization('op')).toEqual(status);
});

it('inspects failed required work without confusing it with a native command error', async () => {
  const status = { ...ready(), state: 'failed', failureCategory: 'readiness', error: 'unsupported', readiness: [
    { kind: 'required', identity: 'tree', state: 'failed' },
  ] };
  expect(await client(status).inspectMaterialization('op')).toEqual(status);
});

it('validates advisory readiness records even when the required tree is complete', async () => {
  const status = { ...ready(), readiness: [
    { kind: 'required', identity: 'tree', state: 'complete' },
    { kind: 'speculative', identity: 'late-font', state: 'invented' },
  ] };
  await expect(client(status).inspectMaterialization('op')).rejects.toBeInstanceOf(TypeError);
  await expect(client([status]).listMaterializations()).rejects.toBeInstanceOf(TypeError);
});

it.each([
  { manifestId: 'another-manifest' },
  { manifestRevision: 'another-revision' },
  { directoryRevision: 'another-tree' },
  { logicalRoot: bytes('/elsewhere'), cwd: bytes('/elsewhere') },
  { cwd: bytes('/work/edit') },
  { entries: [] },
])('rejects changed admitted materialization identity on subsequent inspection %j', async change => {
  let value: unknown = ready();
  const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async (url, init) => Response.json(init?.method === 'GET' && String(url).endsWith('/materializations') ? [value] : value, { headers: { 'Execution-Epoch': 'e' } }) });
  await control.materialize({ sessionId: 's', epoch: 'e', manifestId: 'manifest', manifestRevision: 'revision', bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'key' });
  value = { ...ready(), ...change };
  await expect(control.inspectMaterialization('op')).rejects.toThrow('Materialization identity mismatch');
  await expect(control.listMaterializations()).rejects.toBeInstanceOf(TypeError);
});

it('allows readiness and entry progress to change without rebinding an inspected operation', async () => {
  let value: unknown = { ...ready(), state: 'applying', directoryRevision: null, entries: [{ index: 0, state: 'pending', revision: null }] };
  const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async () => Response.json(value, { headers: { 'Execution-Epoch': 'e' } }) });
  await control.inspectMaterialization('op');
  value = ready();
  expect(await control.inspectMaterialization('op')).toEqual(ready());
  value = { ...ready(), state: 'failed', error: 'wrong-hash', failureCategory: 'integrity' };
  expect(await control.inspectMaterialization('op')).toEqual(value);
});

it('rejects duplicate operation records in a materialization listing', async () => {
  await expect(client([ready(), ready()]).listMaterializations()).rejects.toThrow('Materialization identity mismatch');
});

function exitedJob(): NativeJob {
  return { jobId: 'job', materializationId: 'op', directoryRevision: 'tree', state: 'exited',
    invocation: { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'authority', bindingId: 'binding', materializationId: 'op', manifestId: 'manifest', manifestRevision: 'revision', directoryRevision: 'tree', cwd: bytes('/work'), originalArgv: [bytes('native'), bytes('edit/lists/cut.ffconcat'), []] },
    result: { exitCode: 1, stdout: [], stderr: bytes('edit/lists/cut.ffconcat: missing') } };
}

it.each([
  { jobId: 'another-job' },
  { materializationId: 'another-tree' },
  { directoryRevision: 'another-revision' },
  { state: 'invented' },
  { result: undefined },
  { result: { exitCode: 0, stdout: [256], stderr: [] } },
  { result: { exitCode: 0.5, stdout: [], stderr: [] } },
  { error: 'integrity' },
])('rejects unbound or contradictory native job inspection %j', async change => {
  await expect(client({ ...exitedJob(), ...change }).inspectJob('job')).rejects.toBeInstanceOf(TypeError);
});

it.each(['manifestId', 'manifestRevision', 'bindingId', 'buildId', 'cwd', 'originalArgv'] as const)('binds execution acknowledgement to submitted %s', async field => {
  const job = exitedJob(); const submitted = structuredClone(job.invocation);
  if (field === 'cwd') job.invocation.cwd = bytes('/work/edit');
  else if (field === 'originalArgv') job.invocation.originalArgv.pop();
  else job.invocation[field] = 'replacement';
  await expect(client(job).execute(submitted)).rejects.toThrow('Native job identity mismatch');
});

it('pins recovered job identity while allowing running work to exit with a native error code', async () => {
  let value: NativeJob = { ...exitedJob(), state: 'running', result: undefined };
  const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async () => Response.json(value, { headers: { 'Execution-Epoch': 'e' } }) });
  await control.inspectJob('job');
  value = exitedJob();
  expect(await control.inspectJob('job')).toEqual(value);
  value.invocation.originalArgv[1] = bytes('another/list.ffconcat');
  await expect(control.inspectJob('job')).rejects.toThrow('Native job identity mismatch');
});

it.each(['readiness', 'integrity', 'native'] as const)('preserves a bound %s failure separately from native exits', async error => {
  const job: NativeJob = { ...exitedJob(), state: 'failed', result: undefined, error, failure: { message: 'owned failure', code: 'unsupported' } };
  expect(await client(job).inspectJob('job')).toEqual(JSON.parse(JSON.stringify(job)));
});

it.each(['sessionId', 'epoch'] as const)('rejects a recovered job from another %s', async field => {
  const job = exitedJob(); job.invocation[field] = 'foreign';
  await expect(client(job).inspectJob('job')).rejects.toThrow('Native job identity mismatch');
});

it('binds a first recovered job to an already inspected ready materialization', async () => {
  const job = exitedJob(); job.invocation.manifestRevision = 'replacement';
  const control = createExecutionClient({ baseUrl: 'https://inspection.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async url => Response.json(String(url).includes('/materializations/') ? ready() : job, { headers: { 'Execution-Epoch': 'e' } }) });
  await control.inspectMaterialization('op');
  await expect(control.inspectJob('job')).rejects.toThrow('Native job identity mismatch');
});

it('retains literal binary diagnostics and native nonzero exits without reporting integrity loss', async () => {
  const job = exitedJob(); job.result!.stdout = [0, 255, 128];
  expect(await client(job).execute(job.invocation)).toEqual(job);
});
