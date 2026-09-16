import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes, shellValueText } from "../../../../src/contracts/value.js";
import type { ShellValue } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { IndexedBinding } from "../../../../src/shell/arrays/bindings.js";
import { ArrayFailure } from "../../../../src/shell/arrays/ledger.js";
import { InvocationScope } from "../../../../src/shell/cleanup.js";
import { Runtime } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError, ShellSyntaxError } from "../../../../src/shell/types.js";
import { ValueArena } from "../../../../src/shell/value-state.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>, arrays = true) {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [
    ...(arrays ? [arraysExtension()] : []),
    { name: "reference-contract", create: () => ({ builtins: [{ name: "reference", execute }] }) },
  ] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

async function prepare(context: ShellExtensionContext, value: ShellValue) {
  const result = await context.bindings.prepareReference(value);
  if (!result.ok) assert.fail(shellValueText(result.diagnostic));
  return result.value;
}

test("reference capture leaves scalar intact, early unset removes export, late integer publishes", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    assert.equal(command.bindings.get("who"), "old");
    assert.deepEqual(await reference.unbindName(), { ok: true, value: undefined });
    assert.deepEqual(command.bindings.describe("who"), { kind: "unset", readonly: false, exported: false });
    assert.deepEqual(await reference.assignInteger(123), { ok: true, value: undefined });
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("export who=old; reference; printf '%s' \"$who\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "123");
});

test("native25 case23 effect: bracketed full-name unset retains both indexed members", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[1]");
    assert.deepEqual(await reference.unbindName(), { ok: true, value: undefined });
    await command.bindings.assign("rightSet", command.bindings.get("values", 1) === undefined ? "" : "x");
    await reference.close();
    return 127;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(left right); reference; result=$?; printf 'status:%s;left:%s;right:%s:%s\\n' \"$result\" \"${values[0]}\" \"$rightSet\" \"${values[1]}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "status:127;left:left;right:x:right\n");
});

test("native25 case17 effect: late literal-index publication retains the other member", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[1]");
    await reference.unbindName();
    assert.deepEqual(await reference.assignInteger(123), { ok: true, value: undefined });
    await reference.close();
    return 7;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(left right); reference; result=$?; [[ ${values[1]} == 123 ]]; match=$?; printf 'status:%s;left:%s;identity:%s\\n' \"$result\" \"${values[0]}\" \"$match\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "status:7;left:left;identity:0\n");
});

test("native25 case5 diagnostic body: readonly early unset fails without changing the value", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    const result = await reference.unbindName();
    assert.deepEqual(result, { ok: false, diagnostic: "who: cannot unset: readonly variable" });
    assert.equal(command.bindings.get("who"), "old");
    await reference.close();
    return 1;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("readonly who=old; reference; result=$?; printf 'status:%s;who:%s\\n' \"$result\" \"$who\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "status:1;who:old\n");
});

test("native25 case16 local effect: late assignment remains local after early unset", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    await reference.unbindName();
    assert.equal(command.bindings.get("who"), undefined);
    await reference.assignInteger(123);
    await reference.close();
    return 7;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("who=outer; collect() { local who=old; reference; result=$?; printf 'status:%s;set:%s;value:%s\\n' \"$result\" \"${who+x}\" \"$who\"; }; collect; printf 'outer:%s\\n' \"$who\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "status:7;set:x;value:123\nouter:outer\n");
});

test("reference captures syntax, not an indexed binding snapshot", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[1]");
    const writer = await command.bindings.openIndexed("values", { clear: true });
    await writer.set(0, "replacement");
    await writer.close();
    await reference.assignInteger(42);
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(old old); reference; printf '<%s>' \"${values[@]}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<replacement><42>");
});

test("bare indexed unset removes the whole current binding rather than just index zero", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values");
    await reference.unbindName();
    assert.equal(command.bindings.describe("values").kind, "unset");
    await reference.assignInteger(12);
    assert.equal(command.bindings.describe("values").kind, "scalar");
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(old tail); reference; printf '<%s>' \"${values[@]}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<12>");
});

test("reference publication respects substitution copy-on-write", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[1]");
    await reference.assignInteger(9);
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(left right); child=$(reference; printf '<%s>' \"${values[@]}\"); printf '%s|<%s>' \"$child\" \"${values[1]}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<left><9>|<right>");
});

test("close is idempotent, joins an admitted assignment, and refuses new operations", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[1]");
    const operation = reference.assignInteger(42);
    const closing = reference.close();
    assert.equal(reference.close(), closing);
    await assert.rejects(reference.assignInteger(43), /closed/u);
    await assert.rejects(reference.unbindName(), /closed/u);
    assert.deepEqual(await operation, { ok: true, value: undefined });
    await closing;
    assert.equal(command.bindings.get("values", 1), "42");
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(left right); reference");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("invocation cleanup closes a forgotten reference without undoing its early unset", async context => {
  let captured: Awaited<ReturnType<typeof prepare>> | undefined;
  const shell = setup(async command => {
    captured = await prepare(command, "who");
    await captured.unbindName();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("who=old; reference; printf '%s' \"${who-unset}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "unset");
  await assert.rejects(captured!.assignInteger(1));
  await captured!.close();
});

for (const reason of [false, 0, "", null]) test(`root cancellation precedes closed reference admission: ${JSON.stringify(reason)}`, async context => {
  const controller = new AbortController();
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    await reference.close();
    controller.abort(reason);
    await assert.rejects(reference.assignInteger(1), error => Object.is(error, reason));
    await assert.rejects(reference.unbindName(), error => Object.is(error, reason));
    await assert.rejects(command.bindings.prepareReference("next"), error => Object.is(error, reason));
    return 0;
  });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("reference", { signal: controller.signal }), error => Object.is(error, reason));
});

test("invalid reference diagnostics retain distinct original raw bytes", async context => {
  const shell = setup(async command => {
    for (const byte of [0xfe, 0xff]) {
      const value = shellValueFromBytes(Uint8Array.of(byte));
      const result = await command.bindings.prepareReference(value);
      assert.equal(result.ok, false);
      if (!result.ok) assert.deepEqual(Buffer.from(shellValueBytes(result.diagnostic)), Buffer.concat([Buffer.from("`"), Buffer.from([byte]), Buffer.from("': not a valid identifier")]));
    }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("scalar references require no arrays leaf and compose with default key syntax", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    await reference.assignInteger(-12);
    await reference.close();
    return 0;
  }, false);
  context.after(() => shell.dispose());
  const result = await shell.exec("reference; printf '%s' \"$who\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "-12");
  const keys = await shell.exec("reference; printf '%s' \"${!who[@]}\"");
  assert.equal(keys.exitCode, 0, keys.stderr);
  assert.equal(keys.stdout, "0");
  assert.equal((await shell.exec("printf $!")).exitCode, 2);
});

for (const value of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) test(`integer API rejects invalid input ${value} without publication`, async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    await assert.rejects(reference.assignInteger(value), TypeError);
    assert.equal(command.bindings.get("who"), "old");
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("who=old; reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

for (const value of ["", "1who", "who[]", "who[1]tail", "who\n", "who\0"]) test(`invalid reference admission is nonmutating: ${JSON.stringify(value)}`, async context => {
  const shell = setup(async command => {
    const result = await command.bindings.prepareReference(value);
    assert.deepEqual(result, { ok: false, diagnostic: `\`${value}': not a valid identifier` });
    assert.equal(command.bindings.get("who"), "old");
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("who=old; reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("byte-valued ASCII reference captures syntax and retains export on assignment without unset", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, shellValueFromBytes(Buffer.from("who")));
    await reference.assignInteger(-0);
    assert.deepEqual(command.bindings.describe("who"), { kind: "scalar", readonly: false, exported: true });
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("export who=old; reference; printf '%s' \"$who\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0");
});

test("bare reference assignment resolves current indexed cell zero and preserves sparse tail", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values");
    const writer = await command.bindings.openIndexed("values");
    await writer.set(17, "tail");
    await writer.close();
    await reference.assignInteger(7);
    assert.equal(command.bindings.get("values", 17), "tail");
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=scalar; reference; printf '<%s>' \"${values[@]}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<7><tail>");
});

test("late readonly is an ordinary binding refusal, not a swallowed control failure", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    await reference.unbindName();
    assert.equal(await command.evaluate("readonly who=locked"), 0);
    assert.deepEqual(await reference.assignInteger(9), { ok: false, diagnostic: "who: readonly variable" });
    assert.equal(command.bindings.get("who"), "locked");
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("who=old; reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("unqualified arithmetic subscript is captured without effects and assignment fails explicitly", async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[index++]");
    await reference.unbindName();
    assert.equal(command.bindings.get("index"), "1");
    await assert.rejects(reference.assignInteger(9), ShellSyntaxError);
    assert.equal(command.bindings.get("index"), "1");
    assert.equal(command.bindings.get("values", 1), "right");
    await reference.close();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("index=1; values=(left right); reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

for (const reason of [undefined, null, false, 0, "", new ArrayFailure("sentinel"), new ShellLimitError("maxExpansionBytes")]) test(`canonical publication failures retain exact reason: ${String(reason)}`, async context => {
  const shell = setup(async command => {
    const reference = await prepare(command, "values[1]");
    const publication = context.mock.method(Runtime.prototype, "arrayAssignment", async () => { throw reason; });
    try { await assert.rejects(reference.assignInteger(9), error => Object.is(error, reason)); }
    finally { publication.mock.restore(); await reference.close(); }
    assert.equal(command.bindings.get("values", 1), "right");
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(left right); reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("reentrant close joins publication already admitted before provider work starts", async context => {
  const resolve: { entered?: () => void; gate?: () => void } = {};
  const entered = new Promise<void>(complete => { resolve.entered = complete; });
  const gate = new Promise<void>(complete => { resolve.gate = complete; });
  let reference: Awaited<ReturnType<typeof prepare>> | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;
  const shell = setup(async command => {
    reference = await prepare(command, "values[1]");
    const original = IndexedBinding.prototype.copy;
    const copying = context.mock.method(IndexedBinding.prototype, "copy", async function (this: IndexedBinding, signal: AbortSignal) {
      closing = reference!.close();
      void closing.then(() => { closed = true; });
      resolve.entered!();
      await gate;
      return original.call(this, signal);
    });
    const operation = reference.assignInteger(7);
    try {
      await entered;
      await Promise.resolve();
      assert.equal(closed, false);
      await assert.rejects(reference.unbindName(), /closed/u);
    } finally { resolve.gate!(); }
    try { await operation; await closing; }
    finally { copying.mock.restore(); }
    assert.equal(command.bindings.get("values", 1), "7");
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("values=(left right); reference");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(closed, true);
});

test("reference value reservations are released by close and allocation failures keep their subtype", async context => {
  const shell = setup(async command => {
    const observed: { arena?: ValueArena } = {};
    const original = ValueArena.prototype.hold;
    const holding = context.mock.method(ValueArena.prototype, "hold", function (this: ValueArena, value: ShellValue) {
      observed.arena = this;
      return original.call(this, value);
    });
    const first = await prepare(command, "who");
    const held = { ...observed.arena!.usage };
    await first.close();
    const baseline = { ...observed.arena!.usage };
    assert.ok(baseline.bytes < held.bytes);
    assert.ok(baseline.slots < held.slots);
    for (let iteration = 0; iteration < 20; iteration++) {
      const reference = await prepare(command, "who");
      await reference.close();
      assert.deepEqual(observed.arena!.usage, baseline);
    }
    const failure = new ShellLimitError("maxExpansionBytes");
    holding.mock.restore();
    const refusing = context.mock.method(ValueArena.prototype, "hold", () => { throw failure; });
    try { await assert.rejects(command.bindings.prepareReference("who"), error => error === failure); }
    finally { refusing.mock.restore(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("closed references do not accumulate retained invocation cleanup callbacks", async context => {
  const shell = setup(async command => {
    const bindings = command.bindings;
    const registration = context.mock.method(InvocationScope.prototype, "register");
    try {
      const first = await bindings.prepareReference("who");
      assert.ok(first.ok);
      await first.value.close();
      const count = registration.mock.callCount();
      for (let iteration = 0; iteration < 20; iteration++) {
        const next = await bindings.prepareReference("who");
        assert.ok(next.ok);
        await next.value.close();
      }
      assert.equal(registration.mock.callCount(), count);
    } finally { registration.mock.restore(); }
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("reference");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("invocation cleanup drains admitted reference work before releasing diagnostic storage", async context => {
  let pending: Promise<unknown> | undefined;
  const shell = setup(async command => {
    const reference = await prepare(command, "who");
    pending = reference.unbindName();
    void pending.catch(() => {});
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("readonly who=old; reference");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await pending, { ok: false, diagnostic: "who: cannot unset: readonly variable" });
});
