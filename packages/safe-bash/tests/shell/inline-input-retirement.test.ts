import assert from "node:assert/strict";
import { test } from "node:test";
import { streamCommands } from "../../src/commands/streams.js";
import { ArrayLedger } from "../../src/shell/arrays/ledger.js";
import { IndexedBinding } from "../../src/shell/arrays/bindings.js";
import { StateMonitor } from "../../src/shell/arrays/state.js";
import { ShellInput } from "../../src/shell/input.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

function fixture() {
  const result = setup();
  result.commands.register(streamCommands().find(command => command.name === "cat")!);
  return result;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

for (const redirect of ["<<EOF\nx\nEOF", "<<<x"]) {
  test(`inline snapshot outlives successful file finalization: ${redirect}`, async () => {
    const { shell, fs } = fixture();
    const result = await shell.exec(`cat >out ${redirect}\nsay after`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "after\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "x\n");
  });
}

for (const expansion of ["${VALUE:?stop}", "$((1/0))"]) {
  for (const operator of ["heredoc", "here-string"]) {
    test(`inline snapshot outlives redirected diagnostic: ${operator} ${expansion}`, async () => {
      const { shell, fs } = fixture();
      const redirect = operator === "heredoc" ? `<<EOF\n${expansion}\nEOF` : `<<<"${expansion}"`;
      const result = await shell.exec(`cat 2>errors ${redirect}\nsay after`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "after\n");
      assert.match(new TextDecoder().decode(await fs.readFile("/errors")), expansion === "$((1/0))" ? /division by 0/u : /VALUE: stop/u);
    });
  }
}

for (const cancellation of [undefined, null, false, 0, ""]) {
  test(`inline snapshot joins delayed file finalization: ${String(cancellation)}`, { timeout: 2000 }, async context => {
    const { shell, fs } = fixture();
    const finishing = deferred();
    const release = deferred();
    const controller = new AbortController();
    let outputSignal: AbortSignal | undefined;
    let settled = false;
    let consumed = false;
    Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, randomAccessWrite: false } });
    const writeStream = fs.writeStream.bind(fs);
    context.mock.method(fs, "writeStream", async (...args: Parameters<typeof writeStream>) => {
      outputSignal = args[2]?.signal;
      try { await writeStream(...args); consumed = true; }
      finally { finishing.resolve(); await release.promise; }
    });
    const execution = shell.exec("cat >out <<EOF\nx\nEOF\nsay after", { signal: controller.signal });
    const observed = execution.then(result => ({ result }), (error: unknown) => ({ error })).finally(() => { settled = true; });
    await finishing.promise;
    try {
      assert.equal(consumed, true);
      assert.ok(outputSignal);
      assert.equal(outputSignal.aborted, false);
      assert.equal(settled, false);
      if (cancellation !== undefined) {
        controller.abort(cancellation);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(settled, false);
      }
    } finally { release.resolve(); }
    const outcome = await observed;
    if (cancellation === undefined) {
      assert.ok("result" in outcome);
      assert.equal(outcome.result.exitCode, 0, outcome.result.stderr);
      assert.equal(outcome.result.stderr, "");
      assert.equal(outcome.result.stdout, "after\n");
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "x\n");
    } else {
      assert.ok("error" in outcome);
      assert.equal(outcome.error, cancellation);
    }
  });
}

for (const route of ["heredoc", "builtin", "file"]) {
  for (const count of [1, 2, 4]) {
    test(`${count} ${route} commands retire bookkeeping while root remains active`, async context => {
      const ledgers = new Set<ArrayLedger>();
      const reserve = ArrayLedger.prototype.reserve;
      context.mock.method(ArrayLedger.prototype, "reserve", function(this: ArrayLedger, ...args: Parameters<typeof reserve>) {
        ledgers.add(this);
        return Reflect.apply(reserve, this, args);
      });
      const { shell, commands, fs } = fixture();
      await fs.writeFile("/f", new TextEncoder().encode("x\n"));
      const samples: number[][] = [];
      commands.register({ name: "sample", execute() {
        samples.push([0, 1, 2, 3].map(counter => [...ledgers].reduce((sum, ledger) => sum + ledger.snapshot().used[counter]!, 0)));
        return { exitCode: 0 };
      } });
      const unit = route === "heredoc" ? "cat <<EOF\nx\nEOF\nsample\n" : route === "builtin" ? ": <<EOF\nx\nEOF\nsample\n" : "cat /f\nsample\n";
      const result = await shell.exec(":\nsample\n" + Array(count).fill(unit).join(""));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, route === "builtin" ? "" : "x\n".repeat(count));
      assert.equal(samples.length, count + 1);
      for (const sample of samples.slice(2)) assert.deepEqual(sample, samples[1]);
      for (const ledger of ledgers) assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
    });
  }
}

test("completed inline-input monitors are not retained by root callbacks", async context => {
  let closed = 0;
  let beforeRoot = 0;
  const close = StateMonitor.prototype.closeValues;
  context.mock.method(StateMonitor.prototype, "closeValues", function(this: StateMonitor) {
    closed++;
    return Reflect.apply(close, this, []);
  });
  const { shell, commands } = fixture();
  commands.register({ name: "sample", execute() { beforeRoot = closed; return { exitCode: 0 }; } });
  const result = await shell.exec("cat <<EOF\nx\nEOF\ncat <<<y\nsample");
  assert.equal(result.stdout, "x\ny\n");
  assert.equal(result.stderr, "");
  assert.equal(closed, beforeRoot + 1);
});

test("heredoc snapshots release copied local binding references without changing restoration", async context => {
  const roots = new Set<IndexedBinding>();
  const retain = IndexedBinding.prototype.retain;
  context.mock.method(IndexedBinding.prototype, "retain", function(this: IndexedBinding) {
    if (this.get(0) === "root") roots.add(this);
    return Reflect.apply(retain, this, []);
  });
  const { shell, commands } = fixture();
  const samples: number[] = [];
  commands.register({ name: "sample", execute() {
    samples.push([...roots].reduce((sum, binding) => sum + binding.references, 0));
    return { exitCode: 0 };
  } });
  const body = "cat <<EOF\n${values[0]}\nEOF\nsample\n";
  const result = await shell.exec("values=(root); f() { local -a values; values=(local); sample\n" + Array(4).fill(body).join("") + 'say "${values[0]}"; }; f; say "${values[0]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "local\nlocal\nlocal\nlocal\nlocal\nroot\n");
  assert.equal(result.stderr, "");
  assert.equal(samples.length, 5);
  for (const sample of samples.slice(1)) assert.equal(sample, samples[0]);
});

test("heredoc prefixes and expansion side effects retain their snapshot timing", async () => {
  const { shell } = fixture();
  const result = await shell.exec('V=parent; V=child cat <<EOF\n$V ${NEW:=made}\nEOF\nsay "$V:${NEW-unset}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "child made\nparent:unset\n");
});

test("quoted and skipped heredocs do not evaluate their operands", async () => {
  const { shell, commands } = fixture();
  let ran = 0;
  commands.register({ name: "mark", execute() { ran++; return { exitCode: 0 }; } });
  const result = await shell.exec("cat <<'EOF'\n$(mark) ${NEW:=made}\nEOF\nfalse && cat <<EOF\n$(mark)\nEOF\ntrue");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "$(mark) ${NEW:=made}\n");
  assert.equal(ran, 0);
});

test("heredoc and here-string expansion keep existing byte-limit admission", async () => {
  const { shell } = fixture();
  for (const source of ["cat <<EOF\néé\nEOF\n", "cat <<<éé"]) {
    await assert.rejects(shell.exec(source, { limits: { maxExpansionBytes: 4 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    assert.equal((await shell.exec(source, { limits: { maxExpansionBytes: 5 } })).stdout, "éé\n");
  }
});

for (const reason of [undefined, null, false, 0, ""]) {
  test(`heredoc cleanup preserves falsey failure ${String(reason)}`, async () => {
    const { shell, commands } = fixture();
    let cleaned = 0;
    commands.register({ name: "fail", execute(command) {
      command.registerCleanup!(() => { cleaned++; throw reason; });
      return { exitCode: 0 };
    } });
    await assert.rejects(shell.exec("fail <<EOF\nx\nEOF\ntrue"), error => Object.is(error, reason));
    assert.equal(cleaned, 1);
  });
}

for (const reason of [null, false, 0, ""]) {
  test(`heredoc cancellation ${String(reason)} joins cleanup and local restoration`, async () => {
    const { shell, commands } = fixture();
    const controller = new AbortController();
    const entered = deferred();
    const cleaning = deferred();
    const release = deferred();
    let settled = false;
    let cleaned = 0;
    commands.register({ name: "hold", execute(command) {
      command.registerCleanup!(async () => { cleaned++; cleaning.resolve(); await release.promise; });
      return new Promise<{ exitCode: number }>((_resolve, reject) => {
        command.signal.addEventListener("abort", () => reject(command.signal.reason), { once: true });
        entered.resolve();
      });
    } });
    const pending = shell.exec('values=(root); f() { local -a values; values=(local); V=x hold <<EOF\n${values[0]}\nEOF\n}; f', { signal: controller.signal }).then(
      () => { settled = true; return { failed: false as const }; },
      (error: unknown) => { settled = true; return { failed: true as const, error }; },
    );
    await entered.promise;
    controller.abort(reason);
    await cleaning.promise;
    assert.equal(settled, false);
    release.resolve();
    const result = await pending;
    assert.ok(result.failed && Object.is(result.error, reason));
    assert.equal(cleaned, 1);
  });
}

test("inline input close is awaited and returned bytes outlive the snapshot", async context => {
  const closing = deferred();
  const release = deferred();
  let input: ShellInput | undefined;
  let settled = false;
  const original = ShellInput.prototype.close;
  context.mock.method(ShellInput.prototype, "close", async function(this: ShellInput) {
    if (this === input) { closing.resolve(); await release.promise; }
    return Reflect.apply(original, this, []);
  });
  const { shell, commands } = fixture();
  commands.register({ name: "capture", async execute(command) {
    assert.ok(command.stdin instanceof ShellInput);
    input = command.stdin;
    for await (const bytes of command.stdin) await command.stdout.write(bytes);
    return { exitCode: 0 };
  } });
  const pending = shell.exec("capture <<EOF\né\nEOF\n").then(result => { settled = true; return result; });
  await closing.promise;
  assert.equal(settled, false);
  release.resolve();
  const result = await pending;
  assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("é\n"));
  assert.equal(result.exitCode, 0, result.stderr);
});

for (const rejectRelease of [false, true]) test(`copied local binding retirement is joined before inline execution settles: failure ${rejectRelease}`, async context => {
  const entered = deferred();
  const release = deferred();
  let bodyFinished = false;
  let delayed = false;
  let settled = false;
  const original = IndexedBinding.prototype.release;
  context.mock.method(IndexedBinding.prototype, "release", function(this: IndexedBinding) {
    if (bodyFinished && !delayed && this.get(0) === "root") {
      delayed = true;
      const pending = Reflect.apply(original, this, []);
      entered.resolve();
      return release.promise.then(async () => { await pending; if (rejectRelease) throw false; });
    }
    return Reflect.apply(original, this, []);
  });
  const { shell, commands } = fixture();
  commands.register({ name: "consume", async execute(command) {
    for await (const bytes of command.stdin) await command.stdout.write(bytes);
    bodyFinished = true;
    return { exitCode: 0 };
  } });
  const pending = shell.exec('values=(root); f() { local -a values; values=(local); consume <<EOF\nx\nEOF\n}; f').then(
    result => { settled = true; return { failed: false as const, result }; },
    (error: unknown) => { settled = true; return { failed: true as const, error }; },
  );
  try {
    await Promise.race([entered.promise, pending]);
    assert.equal(delayed, true);
    for (let turn = 0; turn < 4; turn++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { release.resolve(); }
  const result = await pending;
  if (rejectRelease) {
    assert.ok(result.failed && Object.is(result.error, false));
    return;
  }
  assert.ok(!result.failed);
  assert.equal(result.result.stdout, "x\n");
  assert.equal(result.result.exitCode, 0, result.result.stderr);
});

for (const reason of [undefined, null, false, 0, ""]) {
  test(`inline command throw ${String(reason)} preserves shell diagnostic classification`, async () => {
    const { shell, commands } = fixture();
    commands.register({ name: "fail", execute() { throw reason; } });
    const result = await shell.exec("fail <<EOF\nx\nEOF\n");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `shell: line 1: ${String(reason)}\n`);
  });
}

test("inline input disposal preserves a falsey rejection after snapshot retirement", async context => {
  let input: ShellInput | undefined;
  const close = ShellInput.prototype.close;
  context.mock.method(ShellInput.prototype, "close", async function(this: ShellInput) {
    await Reflect.apply(close, this, []);
    if (this === input) throw null;
  });
  const { shell, commands } = fixture();
  commands.register({ name: "capture", execute(command) {
    assert.ok(command.stdin instanceof ShellInput);
    input = command.stdin;
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("capture <<EOF\nx\nEOF\n"), error => Object.is(error, null));
});
