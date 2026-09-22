// Explicit disposable-container HTTPS/process integration. This generic private
// pipe fixture makes no canonical live filesystem or media compatibility claim.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {request as httpsRequest} from 'node:https';
import {Readable} from 'node:stream';
import {createMediaServer, createNativeDriver, startMediaService} from '@poe-code/remote-execution/server';
import {createClient} from '../node_modules/@poe-code/remote-execution/dist/client.js';

const bytes = value => Array.from(new TextEncoder().encode(value));
const limits = {maxJobs: 2, maxHandles: 8, maxArgvBytes: 8192, maxManifestEntries: 8,
  maxFrameBytes: 4096, maxInflightBytes: 8192, maxBlobBytes: 8192, maxReplayBytes: 65536,
  maxCallbacks: 8, maxNativeMemoryBytes: 536870912, maxNativeProcesses: 64, maxJobDurationMs: 30000};

test('explicit HTTPS service serves authenticated SDK jobs, native streams and shutdown', {timeout: 60000}, async () => {
  const key = await readFile('/app/service.key'); const cert = await readFile('/app/service.crt');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(process.execPath)) hash.update(chunk);
  const digest = hash.digest('hex'); const records = new Map(); const operatorErrors = []; let namespacesClosed = 0; let invocationsClosed = 0;
  const build = {digest, imageDigest: process.env.REMOTE_MEDIA_IMAGE_DIGEST, os: 'linux', architecture: 'x86_64',
    executables: {node: digest}, librariesDigest: digest, inventoryDigest: digest, assetsDigest: digest,
    policyDigest: digest, configDigest: digest, launcherRevision: 'explicit-https-fixture', bridgeRevision: 'pipe-only-fixture',
    runtimeRequirements: [], runtimeEnvironment: {}, policyDifferences: ['Pipe-only generic fixture; canonical live mediation is unavailable.'],
    inventory: {codecs: [], coders: [], delegates: [], fonts: [], profiles: []}};
  const grants = [{grantId: 'descriptor', namespaceId: 'work', handleId: 'native-output', operations: ['write'],
    maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString()}];
  const driver = createNativeDriver({backend: {features: [{name: 'descriptors', evidence: ['Explicit private nonseekable output-pipe fixture']}], async inspectBuild() {return structuredClone(build);},
    async admitSession() {return {grants, async prepare(input) {
      assert.equal(input.request.cwd, '/scratch');
      return {cwd: '/scratch', env: {}, async close() {invocationsClosed++;}};
    }, async close() {namespacesClosed++;}};}}});
  const running = await startMediaService({
    async createService() {return createMediaServer({builds: [build], tools: [{id: 'node', buildDigest: digest,
      executable: process.execPath, requiredFeatures: []}], driver,
      async authenticate(request) {return request.headers.get('Authorization') === 'Bearer fixture'
        ? {tenantId: 'fixture', principalId: 'owner', expiresAt: Date.now() + 60000} : null;},
      admissions: {async record(value) {records.set(value.operationId, structuredClone(value));}, async inspect(id) {return records.get(id) ?? null;}},
      storage: {async append() {throw new Error('not used');}, async read() {throw new Error('not used');}, async remove() {}},
      limits, leaseMs: 60000, retentionMs: 10000, maxDocumentBytes: 16384, maxRecords: 32});},
    http: {origin: 'https://127.0.0.1:8443', maxConnections: 16, tls: {key, cert}},
    listen: {host: '127.0.0.1', port: 8443}, sweepIntervalMs: 1000, shutdownGraceMs: 1000,
    requestTimeoutMs: 30000, headersTimeoutMs: 10000, keepAliveTimeoutMs: 1000,
    reportError(error) {operatorErrors.push(error);},
  });
  const baseUrl = 'https://127.0.0.1:8443';
  // Explicit test CA rather than disabling TLS verification globally. Preserve
  // streaming bodies in both directions through the same portable SDK API.
  const fetch = (input, init) => new Promise((resolve, reject) => {
    const request = new Request(input, init);
    const outgoing = httpsRequest(request.url, {method: request.method, headers: Object.fromEntries(request.headers), ca: cert,
      agent: false, signal: request.signal}, incoming => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response(Readable.toWeb(incoming), {status: incoming.statusCode, headers}));
    });
    outgoing.once('error', reject);
    if (request.body) {const body = Readable.fromWeb(request.body); body.once('error', error => outgoing.destroy(error)); body.pipe(outgoing);}
    else outgoing.end();
  });
  const client = createClient({baseUrl, token: async () => 'fixture', fetch}); let session;
  try {
    // Exercise Node's real raw-header boundary: its normalized authorization
    // field alone would retain the valid first credential and discard the other.
    const duplicateStatus = await new Promise((resolve, reject) => {
      const outgoing = httpsRequest(baseUrl + '/v1/capabilities', {ca: cert, agent: false,
        headers: ['Authorization', 'Bearer fixture', 'authorization', 'Bearer other']}, incoming => {
        incoming.resume(); incoming.once('end', () => resolve(incoming.statusCode));
      });
      outgoing.once('error', reject); outgoing.end();
    });
    assert.equal(duplicateStatus, 400);
    assert.equal((await fetch(baseUrl + '/v1/capabilities')).status, 401);
    assert.deepEqual((await client.capabilities()).builds[0].policyDifferences, build.policyDifferences);
    session = await client.openSession({buildDigest: digest, bindings: [{namespaceId: 'work', logicalRoot: '/scratch', rights: ['read'],
      grantId: 'namespace', profile: 'snapshot'}], limits}, 'session');
    const program = "process.stdin.resume();process.stdin.once('end',()=>{process.stdout.write(JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd(),env:process.env.EMPTY}));process.stderr.write('native diagnostic\\n');require('node:fs').writeSync(3,Buffer.from([0,255,128]));process.exitCode=23;});";
    const job = await client.submitJob(session, {buildDigest: digest, toolId: 'node', args: [bytes('-e'), bytes(program), [], bytes('$(id)'), bytes('a b')],
      namespaceId: 'work', materializationRevision: null, cwd: '/scratch', env: {EMPTY: ''}, stdin: {kind: 'stream', seekable: false},
      descriptors: [{fd: 3, handleId: 'native-output', openDescriptionId: 'description', grantId: 'descriptor', rights: ['write'], seekable: false}],
      grants, freshness: 'snapshot', limits}, 'invocation');
    // The native process is deliberately waiting for EOF. Each SDK inspect goes
    // through the real authenticated HTTPS endpoint before submitting input.
    let status = await client.inspectJob(session, job.jobId);
    for (let n = 0; n < 100 && status.state === 'accepted'; n++) status = await client.inspectJob(session, job.jobId);
    assert.equal(status.state, 'running');
    const input = await client.attach(session, job.jobId, {direction: 'input', consumerId: 'stdin'}, 'input');
    await client.sendFrames(session, job.jobId, input.laneId, [{kind: 'end', channelId: 1, sequence: 1n, offset: 0n,
      correlationId: 0n, payload: new Uint8Array()}], {maxFrameBytes: 4096, maxControlBytes: 4096, channels: [1]}, 'eof');
    const result = await client.waitJob(session, job.jobId);
    assert.deepEqual(result.processOutcome, {kind: 'exited', exitCode: 23});
    assert.equal(result.cleanup, 'complete'); assert.equal(result.outputComplete, true);
    const output = await client.attach(session, job.jobId, {direction: 'output', consumerId: 'outputs'}, 'output');
    const chunks = new Map([[2, []], [3, []], [4, []]]); const ended = [];
    for await (const frame of client.readFrames(session, job.jobId, output.laneId, 1n,
      {maxFrameBytes: 4096, maxControlBytes: 4096, channels: [2, 3, 4]})) {
      if (frame.kind === 'data') chunks.get(frame.channelId).push(frame.payload);
      if (frame.kind === 'end') ended.push(frame.channelId);
    }
    assert.deepEqual(JSON.parse(Buffer.concat(chunks.get(2)).toString()), {argv: ['', '$(id)', 'a b'], cwd: '/scratch', env: ''});
    assert.equal(Buffer.concat(chunks.get(3)).toString(), 'native diagnostic\n');
    assert.deepEqual(Buffer.concat(chunks.get(4)), Buffer.from([0, 255, 128])); assert.deepEqual(ended.sort(), [2, 3, 4]);
    await client.closeSession(session, 'close'); session = undefined;
    assert.equal(namespacesClosed, 1); assert.equal(invocationsClosed, 1);
  } finally {if (session) await client.closeSession(session, 'finally'); await running.close();}
  assert.deepEqual(operatorErrors, []);
});
