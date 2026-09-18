import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { PlaywrightAbilityRequest, RegisteredPlaywrightAbility } from '../../src/playwright/abilities.js';
import type { PlaywrightElementHandle, PlaywrightPage } from '../../src/playwright/adapter.js';
import { executePlaywrightAbility } from '../../src/playwright/ability-execution.js';
import type { ParsedInvocation, PlaywrightInvocation } from '../../src/playwright/invocation.js';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((fulfilled, rejected) => { resolve = fulfilled; reject = rejected; });
  return { promise, resolve, reject };
}

function fixture(execute: NonNullable<RegisteredPlaywrightAbility['execute']>) {
  const abort = new AbortController();
  const ability: RegisteredPlaywrightAbility = { execute, scope: 'client', arity: [0, 0], options: {} };
  const parsed: ParsedInvocation = {
    command: 'snapshot', session: 'test', args: [], options: {}, browser: 'chromium',
    headless: true, fullPage: false, imageType: 'png',
  };
  const invocation: PlaywrightInvocation = {
    args: [], env: {}, signal: abort.signal, async write() {},
    async readArtifact() { return new Uint8Array([1]); }, async writeArtifact() {},
  };
  const context: Parameters<typeof executePlaywrightAbility>[3] = {
    signal: abort.signal, maxCommandBytes: 32, maxArtifactBytes: 16,
    check() { abort.signal.throwIfAborted(); },
  };
  return { abort, ability, parsed, invocation, context };
}

function browserFixture() {
  const page: PlaywrightPage = {
    async goto() {}, url: () => 'about:blank',
    locator: () => ({ async click() {}, async fill() {}, async ariaSnapshot() { return ''; } }),
    keyboard: { async press() {} }, async screenshot() { return new Uint8Array(); }, async close() {},
  };
  const target: PlaywrightElementHandle = {
    async evaluate() { throw new Error('unused'); }, async click() {}, async fill() {}, async dispose() {},
  };
  const calls: unknown[] = [];
  const browserSession: NonNullable<PlaywrightAbilityRequest['browserSession']> = {
    context: { async newPage() { return page; }, pages: () => [page], async close() {}, on() {}, off() {} },
    page,
    async resolveTarget(ref) { assert.equal(this, browserSession); calls.push(ref); return target; },
    async selectPage(selected) { assert.equal(this, browserSession); calls.push(selected); },
    registerCleanup(cleanup) { assert.equal(this, browserSession); calls.push(cleanup); },
  };
  return { page, target, calls, browserSession };
}

test('session configuration is forwarded as an isolated readonly copy', async () => {
  const browser = browserFixture();
  const configuration = { outputDir: '/reports', console: { level: 'warning' as const }, timeouts: { navigation: 54321 } };
  const setup = fixture(async request => {
    assert.deepEqual(request.browserSession!.configuration, configuration);
    assert.notEqual(request.browserSession!.configuration, configuration);
    assert.notEqual(request.browserSession!.configuration!.console, configuration.console);
    assert.equal(Object.isFrozen(request.browserSession!.configuration), true);
    assert.equal(Object.isFrozen(request.browserSession!.configuration!.console), true);
    assert.equal(request.limits!.navigationTimeoutMs, 54321);
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, { ...setup.context, navigationTimeoutMs: 54321, browserSession: { ...browser.browserSession, configuration } });
});

test('native code generation forwards owned action inputs and bounds provider output', async () => {
  const browser = browserFixture();
  let retained: NonNullable<PlaywrightAbilityRequest['browserSession']>['generateActionCode'];
  const action = { name: 'hover' as const, selector: '#save' };
  let oversized = false;
  const setup = fixture(async request => {
    retained = request.browserSession!.generateActionCode;
    assert.equal(retained!({ language: 'python', action }), 'page.hover()');
    oversized = true;
    assert.throws(() => retained!({ language: 'python', action }), /byte limit/);
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, { ...setup.context, browserSession: {
    ...browser.browserSession, generateActionCode: value => {
      assert.deepEqual(value, { language: 'python', action });
      assert.notEqual(value.action, action);
      return oversized ? 'x'.repeat(100) : 'page.hover()';
    },
  } });
  assert.throws(() => retained!({ language: 'python', action }), /finished/);
});

test('artifact capture forwards invocation cancellation and clamps the provider byte allowance', async () => {
  const browser = browserFixture();
  const requestedAbort = new AbortController();
  const bytes = new Uint8Array([1, 2]);
  let captureSignal: AbortSignal | undefined;
  const setup = fixture(async request => {
    assert.equal(typeof request.browserSession!.captureArtifact, 'function');
    assert.deepEqual(await request.browserSession!.captureArtifact!(async path => {
      assert.equal(path, '/private/artifact.zip');
    }, { signal: requestedAbort.signal, maxBytes: 999, extension: 'zip' }), bytes);
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, {
    ...setup.context,
    browserSession: { ...browser.browserSession, async captureArtifact(produce, options) {
      assert.equal(options.maxBytes, 16);
      assert.equal(options.extension, 'zip');
      captureSignal = options.signal;
      await produce('/private/artifact.zip');
      return bytes;
    } },
  });
  setup.abort.abort();
  assert.equal(captureSignal!.aborted, true);
});

for (const operation of ['write', 'readFile', 'writeArtifact'] as const) {
  test(`fire-and-forget ${operation} drains before invocation cleanup`, async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const events: string[] = [];
    const setup = fixture(async request => {
      request.registerCleanup(async () => { events.push('cleanup'); });
      if (operation === 'write') void request.write('hello');
      else if (operation === 'readFile') void request.readFile('/input');
      else void request.writeArtifact(new Uint8Array([1]), '/output');
    });
    const pending = async () => { started.resolve(); await release.promise; events.push('effect'); };
    const invocation = {
      ...setup.invocation, write: pending, writeArtifact: pending,
      async readArtifact() { await pending(); return new Uint8Array([1]); },
    };
    const execution = executePlaywrightAbility(setup.ability, setup.parsed, invocation, setup.context);
    let settled = false;
    void execution.then(() => { settled = true; }, () => { settled = true; });
    await started.promise;
    await setImmediate();
    try { assert.equal(settled, false); assert.deepEqual(events, []); }
    finally { release.resolve(); }
    await execution;
    assert.deepEqual(events, ['effect', 'cleanup']);
  });

  test(`${operation} cancellation before dispatch prevents effects and still cleans up`, async () => {
    const reason = new Error('cancelled before IO');
    let cleaned = false;
    let dispatched = false;
    const setup = fixture(async request => {
      request.registerCleanup(async () => { cleaned = true; });
      if (operation === 'write') void request.write('hello');
      else if (operation === 'readFile') void request.readFile('/input');
      else void request.writeArtifact(new Uint8Array([1]));
      setup.abort.abort(reason);
    });
    await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, {
      ...setup.invocation,
      async write() { dispatched = true; }, async writeArtifact() { dispatched = true; },
      async readArtifact() { dispatched = true; return new Uint8Array(); },
    }, setup.context), error => error === reason);
    assert.equal(dispatched, false);
    assert.equal(cleaned, true);
  });

  test(`${operation} cancellation during IO preserves both cancellation and cleanup failure`, async () => {
    const reason = new Error('cancelled during IO');
    const failure = new Error('cleanup failed');
    const setup = fixture(async request => {
      request.registerCleanup(async () => { throw failure; });
      const pending = operation === 'write' ? request.write('hello')
        : operation === 'readFile' ? request.readFile('/input') : request.writeArtifact(new Uint8Array([1]));
      await assert.rejects(pending, error => error === reason);
    });
    await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, {
      ...setup.invocation,
      async write() { setup.abort.abort(reason); }, async writeArtifact() { setup.abort.abort(reason); },
      async readArtifact() { setup.abort.abort(reason); return new Uint8Array([1]); },
    }, setup.context), error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [reason, failure]);
      return true;
    });
  });
}

test('handler, ignored IO, and every cleanup error retain their identities', async () => {
  const writeError = new Error('write');
  const readError = new Error('read');
  const artifactError = new Error('artifact');
  const cleanups: string[] = [];
  const setup = fixture(async request => {
    void request.write('text');
    void request.readFile('/input');
    void request.writeArtifact(new Uint8Array([1]));
    request.registerCleanup(async () => { cleanups.push('first'); throw undefined; });
    request.registerCleanup(async () => { cleanups.push('second'); throw null; });
    throw false;
  });
  await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation,
    async write() { throw writeError; }, async readArtifact() { throw readError; }, async writeArtifact() { throw artifactError; },
  }, setup.context), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [false, writeError, readError, artifactError, undefined, null]);
    return true;
  });
  assert.deepEqual(cleanups, ['first', 'second']);
});

test('an awaited operation failure is not duplicated and duplicate cleanups run once', async () => {
  const failure = new Error('sink');
  let cleanups = 0;
  const setup = fixture(async request => {
    const cleanup = async () => { cleanups++; throw failure; };
    request.registerCleanup(cleanup);
    request.registerCleanup(cleanup);
    await request.write('text');
  });
  await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async write() { throw failure; },
  }, setup.context), error => error === failure);
  assert.equal(cleanups, 1);
});

test('a failing handler still drains ignored IO before cleanup, even when that IO rejects', async () => {
  const release = deferred<void>();
  const started = deferred<void>();
  const handlerFailure = new Error('handler');
  const operationFailure = new Error('operation');
  let cleaned = false;
  const setup = fixture(async request => {
    request.registerCleanup(async () => { cleaned = true; });
    void request.write('text');
    throw handlerFailure;
  });
  const execution = executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async write() { started.resolve(); await release.promise; },
  }, setup.context);
  const verification = assert.rejects(execution, error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [handlerFailure, operationFailure]);
    return true;
  });
  await started.promise;
  await setImmediate();
  try { assert.equal(cleaned, false); }
  finally { release.reject(operationFailure); await verification; }
  assert.equal(cleaned, true);
});

test('synchronously throwing host operations and cleanups remain tracked', async () => {
  const failure = new Error('synchronous output');
  const cleanupFailure = new Error('synchronous cleanup');
  const setup = fixture(async request => {
    request.registerCleanup(() => { throw cleanupFailure; });
    void request.write('text');
  });
  await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, write() { throw failure; },
  }, setup.context), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure, cleanupFailure]);
    return true;
  });
});

test('all retained callbacks reject after the handler, including while cleanup is pending', async () => {
  const browser = browserFixture();
  const started = deferred<void>();
  const release = deferred<void>();
  let retained!: PlaywrightAbilityRequest;
  const setup = fixture(async request => {
    retained = request;
    request.registerCleanup(async () => { started.resolve(); await release.promise; });
  });
  let writes = 0;
  const execution = executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async write() { writes++; }, async readArtifact() { writes++; return new Uint8Array(); },
    async writeArtifact() { writes++; },
  }, { ...setup.context, browserSession: browser.browserSession });
  await started.promise;
  const callbacks = [
    () => retained.write('late'), () => retained.readFile('/late'), () => retained.writeArtifact(new Uint8Array()),
    () => retained.registerCleanup(async () => {}),
    () => retained.browserSession!.resolveTarget('e1'), () => retained.browserSession!.selectPage(browser.page),
    () => retained.browserSession!.registerCleanup(async () => {}),
  ];
  try {
    for (const callback of callbacks) assert.throws(callback, /invocation has finished/);
  } finally { release.resolve(); await execution; }
  for (const callback of callbacks) assert.throws(callback, /invocation has finished/);
  assert.equal(writes, 0);
  assert.deepEqual(browser.calls, []);
});

for (const operation of ['resolveTarget', 'selectPage'] as const) {
  test(`fire-and-forget browserSession.${operation} drains before cleanup`, async () => {
    const browser = browserFixture();
    const started = deferred<void>();
    const release = deferred<void>();
    const events: string[] = [];
    const pending = async () => { started.resolve(); await release.promise; events.push('effect'); };
    const setup = fixture(async request => {
      request.registerCleanup(async () => { events.push('cleanup'); });
      if (operation === 'resolveTarget') void request.browserSession!.resolveTarget('e1');
      else void request.browserSession!.selectPage(browser.page);
    });
    const execution = executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, {
      ...setup.context,
      browserSession: { ...browser.browserSession, selectPage: pending, async resolveTarget() { await pending(); return browser.target; } },
    });
    let settled = false;
    void execution.then(() => { settled = true; }, () => { settled = true; });
    await started.promise;
    await setImmediate();
    try { assert.equal(settled, false); assert.deepEqual(events, []); }
    finally { release.resolve(); await execution; }
    assert.deepEqual(events, ['effect', 'cleanup']);
  });

  test(`browserSession.${operation} errors remain invocation failures if the handler catches them`, async () => {
    const browser = browserFixture();
    const failure = new Error(operation);
    const setup = fixture(async request => {
      const pending = operation === 'resolveTarget' ? request.browserSession!.resolveTarget('e1') : request.browserSession!.selectPage(browser.page);
      await pending.catch(() => {});
    });
    await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, {
      ...setup.context,
      browserSession: { ...browser.browserSession, async resolveTarget() { throw failure; }, async selectPage() { throw failure; } },
    }), error => error === failure);
  });

  test(`browserSession.${operation} checks cancellation before deferred dispatch`, async () => {
    const browser = browserFixture();
    const reason = new Error('cancelled before dispatch');
    const setup = fixture(async request => {
      if (operation === 'resolveTarget') void request.browserSession!.resolveTarget('e1');
      else void request.browserSession!.selectPage(browser.page);
      setup.abort.abort(reason);
    });
    await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, {
      ...setup.context, browserSession: browser.browserSession,
    }), error => error === reason);
    assert.deepEqual(browser.calls, []);
  });

  test(`browserSession.${operation} checks cancellation after completing`, async () => {
    const browser = browserFixture();
    const reason = new Error('cancelled during operation');
    const setup = fixture(async request => {
      const pending = operation === 'resolveTarget' ? request.browserSession!.resolveTarget('e1') : request.browserSession!.selectPage(browser.page);
      await assert.rejects(pending, error => error === reason);
    });
    await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, {
      ...setup.context,
      browserSession: {
        ...browser.browserSession,
        async resolveTarget() { setup.abort.abort(reason); return browser.target; },
        async selectPage() { setup.abort.abort(reason); },
      },
    }), error => error === reason);
  });
}

test('browser capability preserves receivers, identities, and session cleanup lifetime', async () => {
  const browser = browserFixture();
  let invocationCleanups = 0;
  let sessionCleanups = 0;
  const cleanup = async () => { sessionCleanups++; };
  const setup = fixture(async request => {
    assert.ok(Object.isFrozen(request));
    assert.ok(Object.isFrozen(request.browserSession));
    assert.notEqual(request.browserSession, browser.browserSession);
    assert.equal(request.browserSession!.context, browser.browserSession.context);
    assert.equal(request.browserSession!.page, browser.page);
    assert.equal(await request.browserSession!.resolveTarget('e1'), browser.target);
    await request.browserSession!.selectPage(browser.page);
    request.browserSession!.registerCleanup(cleanup);
    request.registerCleanup(async () => { invocationCleanups++; });
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, { ...setup.context, browserSession: browser.browserSession });
  assert.deepEqual(browser.calls, ['e1', browser.page, cleanup]);
  assert.equal(invocationCleanups, 1);
  assert.equal(sessionCleanups, 0);
  await cleanup();
  assert.equal(sessionCleanups, 1);
});

test('session cleanup registration validates callbacks and checks cancellation at admission', async () => {
  const browser = browserFixture();
  const reason = new Error('cancelled at admission');
  const setup = fixture(async request => {
    assert.throws(() => request.browserSession!.registerCleanup(null as unknown as () => Promise<void>), /Invalid Playwright session cleanup/);
    setup.abort.abort(reason);
    assert.throws(() => request.browserSession!.registerCleanup(async () => {}), error => error === reason);
    assert.throws(() => request.browserSession!.resolveTarget('e1'), error => error === reason);
    assert.throws(() => request.browserSession!.selectPage(browser.page), error => error === reason);
  });
  await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, {
    ...setup.context, browserSession: browser.browserSession,
  }), error => error === reason);
  assert.deepEqual(browser.calls, []);
});

test('an already cancelled invocation never starts its handler', async () => {
  const reason = new Error('already cancelled');
  let executed = false;
  const setup = fixture(async () => { executed = true; });
  setup.abort.abort(reason);
  await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, setup.context), error => error === reason);
  assert.equal(executed, false);
});

test('cancellation during cleanup is reported without losing cleanup failures', async () => {
  for (const rejectCleanup of [false, true]) {
    const reason = new Error('cancelled during cleanup');
    const failure = new Error('cleanup failed');
    const setup = fixture(async request => {
      request.registerCleanup(async () => {
        setup.abort.abort(reason);
        if (rejectCleanup) throw failure;
      });
    });
    await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, setup.invocation, setup.context), error => {
      if (!rejectCleanup) return error === reason;
      assert.ok(error instanceof AggregateError);
      assert.ok(error.errors.includes(reason));
      assert.ok(error.errors.includes(failure));
      assert.equal(error.errors.length, 2);
      return true;
    });
  }
});

test('artifact output snapshots Buffer slices before the producer can mutate them', async () => {
  const original = Buffer.from([99, 1, 2, 99]);
  let received: Uint8Array | undefined;
  const setup = fixture(async request => {
    void request.writeArtifact(original.subarray(1, 3), '/virtual/output');
    original.fill(7);
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async writeArtifact(bytes, filename) { received = bytes; assert.equal(filename, '/virtual/output'); },
  }, setup.context);
  assert.deepEqual(received, new Uint8Array([1, 2]));
  assert.notEqual(received!.buffer, original.buffer);
});

test('artifact reads return owned bytes rather than a shared producer Buffer', async () => {
  const original = Buffer.from([99, 1, 2, 99]);
  const setup = fixture(async request => {
    const bytes = await request.readFile('../virtual/input');
    original.fill(7);
    assert.deepEqual(bytes, new Uint8Array([1, 2]));
    bytes.fill(8);
    assert.deepEqual(original, Buffer.from([7, 7, 7, 7]));
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async readArtifact() { return original.subarray(1, 3); },
  }, setup.context);
});

test('UTF-8 text, input, and output share the exact command byte budget', async () => {
  const effects: unknown[] = [];
  const setup = fixture(async request => {
    await request.write('é');
    await request.readFile('/input');
    await request.writeArtifact(new Uint8Array([1, 2]));
    assert.throws(() => request.write('x'), /command byte limit/);
    assert.throws(() => request.writeArtifact(new Uint8Array([3])), /command byte limit/);
    await request.write('');
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation,
    async write(text) { effects.push(text); },
    async readArtifact(filename, maxBytes) { effects.push([filename, maxBytes]); return new Uint8Array([1, 2, 3]); },
    async writeArtifact(bytes) { effects.push([...bytes]); },
  }, { ...setup.context, maxCommandBytes: 7 });
  assert.deepEqual(effects, ['é', ['/input', 5], [1, 2], '']);
});

test('UTF-8 and per-artifact overflows fail before reaching destinations', async () => {
  const setup = fixture(async request => {
    assert.throws(() => request.write('💥'), /command byte limit/);
    assert.throws(() => request.writeArtifact(new Uint8Array(3)), /Artifact byte limit/);
    await request.write('abc');
  });
  const output: string[] = [];
  await executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async write(text) { output.push(text); },
    async writeArtifact() { assert.fail('rejected artifact reached destination'); },
  }, { ...setup.context, maxCommandBytes: 3, maxArtifactBytes: 2 });
  assert.deepEqual(output, ['abc']);
});

test('concurrent reads cannot overrun their shared command budget', async () => {
  const setup = fixture(async request => { void request.readFile('/first'); void request.readFile('/second'); });
  await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async readArtifact() { return new Uint8Array(3); },
  }, { ...setup.context, maxCommandBytes: 5 }), /command byte limit/);
});

test('readers receive the artifact cap and honor an exact-boundary result', async () => {
  const setup = fixture(async request => { assert.equal((await request.readFile('/input')).byteLength, 2); });
  await executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, async readArtifact(filename, maxBytes) {
      assert.equal(filename, '/input');
      assert.equal(maxBytes, 2);
      return new Uint8Array(2);
    },
  }, { ...setup.context, maxArtifactBytes: 2 });
});

test('missing artifact capabilities fail without falling back to native files', async () => {
  const setup = fixture(async request => {
    assert.throws(() => request.readFile('/input'), /Virtual artifact input unsupported/);
    assert.throws(() => request.writeArtifact(new Uint8Array(), '/output'), /Artifact byte destination unsupported/);
    assert.throws(() => request.write(new Uint8Array() as unknown as string), /output must be text/);
    assert.throws(() => request.writeArtifact('text' as unknown as Uint8Array), /output must be bytes/);
    assert.throws(() => request.registerCleanup(null as unknown as () => Promise<void>), /Invalid Playwright ability cleanup/);
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation, readArtifact: undefined, writeArtifact: undefined,
  }, setup.context);
});

test('oversized and non-byte reader results reject and still run cleanup', async () => {
  for (const value of [new Uint8Array(17), 'invalid']) {
    let cleaned = false;
    const setup = fixture(async request => {
      request.registerCleanup(async () => { cleaned = true; });
      void request.readFile('/input');
    });
    await assert.rejects(executePlaywrightAbility(setup.ability, setup.parsed, {
      ...setup.invocation, async readArtifact() { return value as Uint8Array; },
    }, setup.context), value instanceof Uint8Array ? /Artifact byte limit/ : /must return bytes/);
    assert.equal(cleaned, true);
  }
});

test('virtual paths are forwarded literally without native file access', async () => {
  const paths = ['/virtual/a b', '../relative;$(touch nope)', 'C:\\virtual\\data', 'https://example.test/not-a-fetch'];
  const reads: string[] = [];
  const writes: (string | undefined)[] = [];
  const setup = fixture(async request => {
    for (const filename of paths) { await request.readFile(filename); await request.writeArtifact(new Uint8Array(), filename); }
    for (const filename of ['', 'bad\0path', undefined, 1]) {
      assert.throws(() => request.readFile(filename as string), /Invalid virtual artifact filename/);
      if (filename !== undefined) assert.throws(() => request.writeArtifact(new Uint8Array(), filename as string), /Invalid virtual artifact filename/);
    }
    await request.writeArtifact(new Uint8Array());
  });
  await executePlaywrightAbility(setup.ability, setup.parsed, {
    ...setup.invocation,
    async readArtifact(filename) { reads.push(filename); return new Uint8Array(); },
    async writeArtifact(_bytes, filename) { writes.push(filename); },
  }, setup.context);
  assert.deepEqual(reads, paths);
  assert.deepEqual(writes, [...paths, undefined]);
});
