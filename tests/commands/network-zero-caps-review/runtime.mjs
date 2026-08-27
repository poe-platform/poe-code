import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cases, defaults, huge, invalid } from './profile.mjs';

const payload = Uint8Array.from([0, 255, 13, 10, 65, 128, 66]);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const decode = chunks => Buffer.concat(chunks).toString('utf8');

export async function runSuite(root, network, { baseline = false, select = () => true, validators = true } = {}) {
  const receipts = [];
  const check = async (name, operation) => {
    try { receipts.push({ name, pass: true, ...await operation() }); }
    catch (error) { receipts.push({ name, pass: false, error: String(error.stack ?? error) }); }
  };
  assert.deepEqual(network.defaultNetworkLimits, defaults);
  assert.equal(Object.isFrozen(network.defaultNetworkLimits), true);
  for (const factory of validators ? ['createCurlCommand', 'networkCommands'] : []) {
    for (const name of Object.keys(defaults)) {
      const count = name === 'maxRedirects' || name === 'maxRetries';
      const values = [['zero', 0], ['negative-zero', -0], ['one', 1], ['max-safe', huge], ...invalid];
      if (name === 'maxTimeMs') values.push(['timeout-ceiling', 2147483647], ['timeout-over', 2147483648]);
      for (const [label, value] of values) {
        await check(`validator/${factory}/${name}/${label}`, () => {
          const accepted = Number.isSafeInteger(value) && value >= (count && !baseline ? 0 : 1)
            && (name !== 'maxTimeMs' || value <= 2147483647);
          let calls = 0;
          const operation = () => network[factory]({ limits: { [name]: value },
            authorize: () => { calls++; return true; }, transport: async () => { throw Error('not invoked'); } });
          if (accepted) assert.doesNotThrow(operation);
          else assert.throws(operation, { name: 'RangeError', message: `Invalid network limit: ${name}` });
          assert.equal(calls, 0);
          return { accepted, baselineConfigurationLimitation: baseline && count && value === 0 };
        });
      }
    }
  }
  for (const mode of ['direct', 'shell']) for (const spec of cases().filter(select)) {
    if (baseline && Object.values(spec.limits).includes(0)) {
      receipts.push({ name: `${mode}/${spec.name}`, skipped: 'baseline zero constructor configuration limitation' });
      continue;
    }
    await check(`${mode}/${spec.name}`, () => runCase(root, network, spec, mode));
  }
  return { counts: {
    passed: receipts.filter(item => item.pass).length,
    failed: receipts.filter(item => item.pass === false).length,
    skipped: receipts.filter(item => item.skipped).length,
  }, receipts };
}

async function runCase(root, network, spec, mode) {
  const fs = new root.MemoryFileSystem();
  await fs.writeFile('/upload', payload);
  const stdout = [];
  const stderr = [];
  const requests = [];
  const authorization = [];
  const events = [];
  let opens = 0;
  let reads = 0;
  let uploadBytes = 0;
  let disposals = 0;
  let responseReads = 0;
  const originalRead = fs.readStream.bind(fs);
  fs.readStream = (path, options) => {
    assert.equal(path, '/upload');
    assert.ok(options.signal instanceof AbortSignal);
    opens++;
    events.push('upload-open');
    return (async function* () {
      for await (const chunk of originalRead(path, options)) { reads++; uploadBytes += chunk.length; yield chunk; }
    })();
  };
  const controller = new AbortController();
  const abortReason = new Error('independent-cooperative-abort');
  const transportError = new network.CurlError(7, 'independent-transport-sentinel');
  const urls = Array.from({ length: spec.urls ?? 1 }, (_, index) => `https://first.invalid/input-${index}`);
  const options = {
    limits: spec.limits,
    authorize: request => {
      authorization.push({ url: request.url, attempt: request.attempt, redirectFrom: request.redirectFrom ?? null });
      events.push('authorize');
      assert.equal(request.signal.aborted, false);
      return authorization.length !== spec.deny;
    },
    transport: async request => {
      const requestIndex = requests.length;
      const status = spec.responses[requestIndex];
      assert.notEqual(status, undefined, 'unexpected extra transport request');
      requests.push({ url: request.url, method: request.method, bodyHex: '' });
      events.push('transport');
      assert.equal(authorization.at(-1).url, request.url);
      const chunks = [];
      if (request.body) for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
      const uploaded = Buffer.concat(chunks);
      requests.at(-1).bodyHex = uploaded.toString('hex');
      assert.deepEqual(uploaded, spec.upload ? Buffer.from(payload) : Buffer.alloc(0));
      if (requestIndex > 0 && [307, 308].includes(spec.responses[requestIndex - 1])) {
        assert.equal(request.headers.some(([name]) => name.toLowerCase() === 'authorization'), false);
      }
      if (status === 'error') throw transportError;
      let disposed = false;
      return {
        status: status === 'abort' ? 200 : status,
        statusText: 'Independent fixture',
        headers: [
          ...([307, 308].includes(status) ? [['Location', `https://next.invalid/hop-${requestIndex}`]] : []),
          ...(spec.retryAfter ? [['Retry-After', spec.retryAfter]] : []),
        ],
        body: (async function* () {
          responseReads++;
          if (status === 'abort') { controller.abort(abortReason); throw abortReason; }
          yield Buffer.from(`body-${status}`);
        })(),
        async dispose() { assert.equal(disposed, false); disposed = true; disposals++; events.push('dispose'); },
      };
    },
  };
  const args = [...spec.args, ...(spec.upload ? ['--upload-file', '/upload'] : []),
    '-H', 'Authorization: Bearer synthetic-fixture',
    '--write-out', '|STATUS:%{http_code}:%{exitcode}:%{num_retries}:%{num_redirects}|', ...urls];
  let exit;
  let thrown;
  let shell;
  try {
    if (mode === 'direct') {
      const result = await network.createCurlCommand(options).execute({
        command: 'curl', args, fs, cwd: '/', env: {}, signal: controller.signal,
        stdin: root.toByteSource(''), stdinIsDefault: true,
        stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
        stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
      });
      exit = result.exitCode;
    } else {
      shell = new root.Shell({ fs }).use(network.networkCommands(options));
      const result = await shell.exec(['curl', ...args].map(quote).join(' '), { signal: controller.signal });
      exit = result.exitCode;
      stdout.push(Buffer.from(result.stdoutBytes));
      stderr.push(Buffer.from(result.stderrBytes));
    }
  } catch (error) { thrown = error; }
  finally { if (shell) await shell.dispose(); }
  await Promise.resolve();
  const text = decode(stdout);
  const writeouts = [...text.matchAll(/\|STATUS:(\d+):(\d+):(\d+):(\d+)\|/g)].map(match => match.slice(1).map(Number));
  const body = text.replaceAll(/\|STATUS:\d+:\d+:\d+:\d+\|/g, '');
  if (spec.abort) assert.equal(thrown, abortReason, 'abort preserves public rejection identity');
  else {
    assert.equal(thrown, undefined);
    assert.equal(exit, spec.expected.exit);
    assert.equal(writeouts.length, spec.urls ?? 1);
    assert.equal(writeouts.at(-1)[1], spec.expected.exit);
    const finalStatus = spec.responses[requests.length - 1];
    assert.equal(writeouts.at(-1)[0], typeof finalStatus === 'number' ? finalStatus : 0);
    assert.equal(writeouts.at(-1)[2], authorization.at(-1)?.attempt ?? 0);
    assert.equal(writeouts.at(-1)[3], authorization.filter(item => item.redirectFrom !== null).length);
    if (spec.name.startsWith('retry-') || spec.name === 'default-cli-no-retry') {
      assert.equal(writeouts.at(-1)[0], spec.responses[spec.expected.requests - 1]);
    }
  }
  assert.equal(requests.length, spec.expected.requests, 'transport count');
  assert.equal(authorization.length, spec.expected.auth, 'authorization count');
  assert.equal(disposals, spec.expected.disposals, 'response disposal count');
  assert.equal(opens, spec.expected.reads, 'upload stream opens');
  assert.equal(reads, spec.expected.reads, 'upload stream chunks');
  assert.equal(uploadBytes, spec.expected.reads * payload.length, 'upload bytes');
  const retryBody = spec.expected.requests > 1 || spec.name === 'retry-denial';
  const expectedBody = retryBody && spec.responses.some(status => [429, 503].includes(status))
    ? spec.responses.slice(0, spec.expected.requests).map(status => `body-${status}`).join('')
    : spec.expected.body;
  assert.equal(body, expectedBody, 'baseline-qualified frozen body contract');
  for (let index = 0; index < requests.length; index++) {
    const auth = authorization[index];
    const previousStatus = spec.responses[index - 1];
    const isRedirect = index > 0 && [307, 308].includes(previousStatus);
    const isRetry = index > 0 && [429, 503].includes(previousStatus);
    assert.equal(auth.redirectFrom, isRedirect ? requests[index - 1].url : null);
    assert.equal(auth.attempt, isRetry ? index : 0);
  }
  if (spec.responses[0] === 'error') {
    assert.equal(decode(stderr), 'curl: (7) independent-transport-sentinel\n');
    assert.equal(transportError.message, 'independent-transport-sentinel');
  }
  return { exit: exit ?? 'rejected', abortIdentity: thrown === abortReason,
    requests, authorization, opens, reads, uploadBytes, disposals, responseReads,
    body, writeouts, stderr: decode(stderr), eventsHash: createHash('sha256').update(JSON.stringify(events)).digest('hex') };
}
