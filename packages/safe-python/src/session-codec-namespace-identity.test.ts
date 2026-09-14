import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecNamespaceIdentityCases, codecNamespaceSearchSource} from './codec-namespace-identity-cases.js';

it.each(codecNamespaceIdentityCases)('codec namespace identity: $name', ({source, output: expected}) => {
  let output = '';
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    output: {write(text) { output += text; }, flush() {}},
  });
  const result = session.exec(source);
  let diagnostic: string | undefined;
  if (result.status === 'exception') {
    session.globals.set('failure', result.exception);
    const message = session.eval('str(failure)');
    if (message.status === 'ok') diagnostic = String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe('ok');
  expect(output).toBe(expected);
});

it.each([false, true])('preserves namespace/search identity at output cancellation=%s', cancelled => {
  const controller = new AbortController();
  const writes: string[] = [];
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal,
    output: {write(text) { writes.push(text); if (cancelled) controller.abort(); }, flush() {}},
  });
  const result = session.exec(codecNamespaceSearchSource);
  if (cancelled) {
    expect(result).toMatchObject({status: 'terminated', reason: 'cancelled'});
    expect(session.eval('1')).toMatchObject({status: 'terminated', reason: 'cancelled'});
    expect(writes).toEqual(['search']);
  } else {
    expect(result.status).toBe('ok');
    expect(writes.join('')).toBe('search\n');
  }
});
