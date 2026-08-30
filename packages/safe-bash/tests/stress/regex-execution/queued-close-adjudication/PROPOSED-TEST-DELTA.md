# Proposal only: canonical owner approval required

Do not apply as part of this adjudication. The original canonical file remains
byte-for-byte unchanged (SHA256
`29b38d1603829e8f914410463b0537752aa585444a990e204b96948b92d14214`).
Keep that original at `01aa1bffe0568cc6787d5ff8e0331e024a787385`, its failing
99/100 TAP, and this targeted failing replay as historical evidence. This proposal
does not turn any historical denominator green.

In the existing `idle messageerror retires promptly, holds capacity and close
awaits cleanup` test, replace only the block from `const closing = second.close()`
through `await closing;` with:

```ts
    const closePromise = second.close();
    const closing = closePromise.then(() => { closed = true; });
    assert.equal(second.close(), closePromise);
    assert.throws(() => second.run(descriptor, rows), {
      code: "CLOSED", message: "regex CLOSED: invocation is closed",
    });
    await tick();
    assert.equal(workers.length, 1);
    assert.equal(closed, false);
    assert.equal(workers[0]!.terminated, false);
    const result = await queued;
    assert.equal(errorCode(result.error), "CLOSED");
    assert.ok(result.error instanceof Error);
    assert.equal(result.error.name, "RegexExecutionError");
    assert.equal(result.error.message, "regex CLOSED: invocation is closed");
    releaseTermination();
    await closing;
    assert.equal(closed, true);
    assert.equal(workers.length, 1);
    assert.equal(workers[0]!.posts.length, 1);
    assert.throws(() => second.run(descriptor, rows), {
      code: "CLOSED", message: "regex CLOSED: invocation is closed",
    });
```

Keep the surrounding duplicate-messageerror, prompt termination, `clean`, and
`finally` checks unchanged. Keep all startup/active/precedence/native tests
unchanged. Add the following companion test using the existing canonical helpers;
it preserves the valid second-Worker expectation specifically for an OPEN owner:

```ts
test("idle messageerror holds capacity until retirement for an open queued session", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const executor = new RegexExecutor({ maxWorkers: 1, idleTimeoutMs: 1000 });
  const first = executor.open(controller.signal);
  const second = executor.open(controller.signal);
  const initial = settle(first.run(descriptor, rows));
  let queued: ReturnType<typeof settle> | undefined;
  try {
    await tick();
    workers[0]!.reply();
    assert.equal((await initial).error, undefined);
    workers[0]!.emit("messageerror", new Error("idle deserialization failure"));
    workers[0]!.emit("messageerror", new Error("duplicate idle failure"));
    queued = settle(second.run(descriptor, rows));
    await first.close();
    await tick();
    assert.equal(workers.length, 1);
    assert.equal(workers[0]!.terminationCalls, 1);
    assert.equal(workers[0]!.terminated, false);
    releaseTermination();
    await tick();
    assert.equal(workers[0]!.terminated, true);
    assert.equal(workers.length, 2);
    workers[1]!.reply();
    assert.deepEqual(await queued, { value: [[{ start: 0, end: 1 }]], error: undefined });
    await second.close();
    clean(controller.signal);
  } finally {
    releaseTermination();
    controller.abort();
    await initial;
    await queued;
    await first.close();
    await second.close();
    await executor.dispose();
  }
});
```

The proposed canonical edit/addition is not applied or counted as a passing test.
Its two behaviors are independently exercised by the first two owned controls;
those are new evidence, not replacements for original canonical results.
