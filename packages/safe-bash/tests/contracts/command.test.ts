import assert from "node:assert/strict";
import test from "node:test";
import * as commandContract from "../../src/contracts/command.js";
import { shellValueBytes, shellValueFromBytes, type ShellValue, type ValueAllocation } from "../../src/contracts/value.js";
import {
  ACCESS_MODES, CommandRegistry, composeMiddleware, FsError, toByteSource, validateExitCode,
  type CommandContext, type CommandDefinition, type FileSystem, type Middleware,
  type PluginHost, type VirtualShellPlugin,
} from "../../src/contracts/index.js";

function makeContext(): CommandContext {
  const unsupported = async (): Promise<never> => { throw new FsError("ENOTSUP"); };
  const fs: FileSystem = {
    capabilities: { readOnly: true },
    readFile: unsupported, writeFile: unsupported, appendFile: unsupported,
    stat: unsupported, lstat: unsupported, readdir: unsupported,
    mkdir: unsupported, rm: unsupported, rename: unsupported,
    copyFile: unsupported, realpath: unsupported, access: unsupported,
  };
  return {
    command: "example", args: ["one"], cwd: "/", env: {}, fs,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
  };
}

const success: CommandDefinition = { name: "example", execute: () => ({ exitCode: 0 }) };

test("owned command arguments snapshot values and distinguish equal text projections", () => {
  const first = shellValueFromBytes(Uint8Array.of(255));
  const second = shellValueFromBytes(Uint8Array.of(254));
  const input: ShellValue[] = [first, second, "plain"];
  const owned = commandContract.createCommandArguments(input);
  input[0] = "changed";
  assert.notEqual(owned.values, input);
  assert.ok(Object.isFrozen(owned) && Object.isFrozen(owned.args) && Object.isFrozen(owned.values));
  assert.equal(owned.args[0], owned.args[1]);
  assert.deepEqual(Array.from(owned.bytes(0)!), [255]);
  assert.deepEqual(Array.from(owned.bytes(1)!), [254]);
  owned.bytes(0)!.fill(0);
  assert.deepEqual(Array.from(owned.bytes(0)!), [255]);
  assert.equal(owned.bytes(3), undefined);
  assert.equal(owned.bytes(-1), undefined);
});

test("owned command argument derivation shares immutable values without byte round trips", () => {
  const raw = shellValueFromBytes(Uint8Array.of(255));
  const owned = commandContract.createCommandArguments(["start", raw, "end"]);
  const selected = owned.select([1, 1, 0]);
  assert.deepEqual(selected.args, ["\ufffd", "\ufffd", "start"]);
  assert.equal(selected.values[0], raw);
  assert.equal(selected.values[1], raw);
  assert.equal(owned.slice(1, 2).values[0], raw);
  assert.deepEqual(owned.slice(-1).args, ["end"]);
  assert.deepEqual(owned.slice(2, 1).args, []);
  assert.deepEqual(owned.slice().concat(selected).values, [...owned.values, ...selected.values]);
  assert.throws(() => owned.select([3]), RangeError);
  assert.throws(() => owned.select([-1]), RangeError);
  assert.throws(() => owned.select([0.5]), RangeError);
});

test("owned command arguments require exact argv identity and reject forged carriers", () => {
  const owned = commandContract.createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  const context = { ...makeContext(), args: owned.args, argumentValues: owned };
  assert.equal(commandContract.getCommandArguments(context), owned);
  assert.throws(() => commandContract.getCommandArguments({ ...context, args: [...owned.args] }), /argument.*identity/i);
  assert.throws(() => commandContract.getCommandArguments({ ...context, argumentValues: { ...owned } }), /owned command arguments/i);
  assert.deepEqual(Array.from(commandContract.getCommandArguments(makeContext()).bytes(0)!), Array.from(new TextEncoder().encode("one")));
});

test("owned command argument allocations precede snapshot reads and commit exact carrier", () => {
  const events: string[] = [];
  const committed: object[] = [];
  const allocation: ValueAllocation = {
    assertOpen() { events.push("open"); },
    reserve(bytes, slots) {
      assert.ok(bytes >= 0 && Number.isSafeInteger(bytes));
      assert.ok(slots > 0 && Number.isSafeInteger(slots));
      events.push("reserve");
      return { commit(value) { events.push("commit"); committed.push(value); }, release() { events.push("release"); } };
    },
  };
  const input: ShellValue[] = ["initial"];
  Object.defineProperty(input, "0", { get() { events.push("read"); return "owned"; } });
  const owned = commandContract.createCommandArguments(input, allocation);
  assert.deepEqual(events, ["open", "reserve", "read", "commit"]);
  assert.equal(committed[0], owned);
  const selected = owned.select([0]);
  assert.equal(committed[1], selected);
  const bytes = owned.bytes(0);
  assert.equal(committed[2], bytes);
});

for (const reason of [false, 0, undefined]) test(`owned command argument admission preserves denial before reads: ${String(reason)}`, () => {
  let reads = 0;
  const input: ShellValue[] = ["not read"];
  Object.defineProperty(input, "0", { get() { reads++; return "not read"; } });
  let caught = false;
  try {
    commandContract.createCommandArguments(input, { assertOpen() { throw reason; }, reserve() { throw new Error("not reserved"); } });
  } catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true);
  assert.equal(reads, 0);
});

test("owned command argument failed projection releases its reservation", () => {
  let released = 0;
  assert.throws(() => commandContract.createCommandArguments([{} as ShellValue], {
    assertOpen() {},
    reserve() { return { commit() { throw new Error("must not commit"); }, release() { released++; } }; },
  }), /owned shell byte value/);
  assert.equal(released, 1);
});

test("owned command arguments pass through middleware with independent byte copies", async () => {
  const owned = commandContract.createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  const context = { ...makeContext(), args: owned.args, argumentValues: owned };
  const execute = composeMiddleware([async (incoming, next) => {
    commandContract.getCommandArguments(incoming).bytes(0)!.fill(0);
    return next();
  }], incoming => {
    assert.deepEqual(Array.from(commandContract.getCommandArguments(incoming).bytes(0)!), [255]);
    return { exitCode: 0 };
  });
  assert.deepEqual(await execute(context), { exitCode: 0 });
});

test("owned command reconstruction and joining preserve the original allocation authority", () => {
  let open = true;
  const reason = new Error("closed argument owner");
  const committed: object[] = [];
  const allocation: ValueAllocation = {
    assertOpen() { if (!open) throw reason; },
    reserve() { return { commit(value) { committed.push(value); }, release() {} }; },
  };
  const original = commandContract.createCommandArguments(["first"], allocation);
  const input = Uint8Array.of(255);
  const rebuilt = original.withValues([input, "last"]);
  input.fill(0);
  assert.deepEqual(Array.from(rebuilt.bytes(0)!), [255]);
  const joined = rebuilt.join(":");
  const selected = original.withValues([joined]);
  assert.deepEqual(Array.from(selected.bytes(0)!), [255, 58, 108, 97, 115, 116]);
  assert.ok(committed.includes(rebuilt) && committed.includes(joined as object) && committed.includes(selected));
  open = false;
  assert.throws(() => rebuilt.bytes(0), error => error === reason);
  assert.throws(() => rebuilt.slice(0), error => error === reason);
  assert.throws(() => rebuilt.withValues([Uint8Array.of(254)]), error => error === reason);
  assert.throws(() => rebuilt.join(), error => error === reason);
});

test("owned command arguments preserve falsey commit and release failures in order", () => {
  let releases = 0;
  assert.throws(() => commandContract.createCommandArguments(["value"], {
    assertOpen() {},
    reserve() { return { commit() { throw undefined; }, release() { releases++; throw false; } }; },
  }), error => error instanceof AggregateError && error.errors.length === 2 && error.errors[0] === undefined && error.errors[1] === false);
  assert.equal(releases, 1);
});

for (const operation of ["create", "select", "withValues"] as const) {
  for (const change of ["grow", "shrink"] as const) test(`owned command ${operation} rejects ${change} during reservation`, () => {
    const input: ShellValue[] = ["original"];
    const indices = [0];
    let active = false;
    let released = 0;
    let committed = 0;
    const allocation: ValueAllocation = {
      assertOpen() {},
      reserve() {
        if (active) {
          if (operation === "select") {
            if (change === "grow") indices.push(0);
            else indices.pop();
          } else if (change === "grow") input.push("unexpected");
          else input.pop();
        }
        return { commit() { committed++; }, release() { released++; } };
      },
    };
    const original = commandContract.createCommandArguments(["original"], allocation);
    active = true;
    const invoke = (): commandContract.CommandArguments => operation === "create"
      ? commandContract.createCommandArguments(input, allocation)
      : operation === "select" ? original.select(indices) : original.withValues(input);
    assert.throws(invoke, /extent changed during admission/);
    assert.equal(released, 1);
    assert.equal(committed, 1);
    assert.deepEqual(original.args, ["original"]);
  });
}

test("owned command withValues snapshots every operand before nested byte reservations", () => {
  const incoming: (ShellValue | Uint8Array)[] = [Uint8Array.of(255), "retained"];
  let reservations = 0;
  let active = false;
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() {
      if (active && ++reservations === 2) incoming[1] = "changed";
      return { commit() {}, release() {} };
    },
  };
  const original = commandContract.createCommandArguments([], allocation);
  active = true;
  const rebuilt = original.withValues(incoming);
  assert.deepEqual(rebuilt.args, ["\ufffd", "retained"]);
  assert.deepEqual(Array.from(rebuilt.bytes(0)!), [255]);
  assert.equal(incoming[1], "changed");
});

test("owned command selection does not reread indices during carrier commit", () => {
  const indices = [0, 1];
  let active = false;
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() {
      return { commit() { if (active) indices.reverse(); }, release() {} };
    },
  };
  const original = commandContract.createCommandArguments(["first", "second"], allocation);
  active = true;
  const selected = original.select(indices);
  assert.deepEqual(selected.args, ["first", "second"]);
  assert.deepEqual(indices, [1, 0]);
});

for (const operation of ["create", "select", "withValues"] as const) {
  for (const reason of [new Error("closed allocation"), false, 0, undefined]) {
    test(`owned command ${operation} checks lifetime before caller length: ${String(reason)}`, () => {
      let open = true;
      let observations = 0;
      const allocation: ValueAllocation = {
        assertOpen() { if (!open) throw reason; },
        reserve() { return { commit() {}, release() {} }; },
      };
      const original = commandContract.createCommandArguments(["first"], allocation);
      const input = new Proxy(operation === "select" ? [0] : ["first"], {
        get(target, property, receiver) {
          if (property === "length") { observations++; throw new Error("caller length observed"); }
          return Reflect.get(target, property, receiver);
        },
      });
      open = false;
      let caught = false;
      try {
        if (operation === "create") commandContract.createCommandArguments(input as string[], allocation);
        else if (operation === "select") original.select(input as number[]);
        else original.withValues(input as string[]);
      } catch (error) { caught = true; assert.equal(error, reason); }
      assert.equal(caught, true);
      assert.equal(observations, 0);
    });
  }
}

for (const reason of [new Error("second byte allocation denied"), false, 0, undefined]) {
  test(`owned command failed reconstruction releases only new reservations: ${String(reason)}`, () => {
    let charged = 0;
    let active = false;
    let reservations = 0;
    const allocation: ValueAllocation = {
      assertOpen() {},
      reserve(bytes) {
        if (active && ++reservations === 3) throw reason;
        charged += bytes;
        let released = false;
        return { commit() {}, release() { assert.equal(released, false); released = true; charged -= bytes; } };
      },
    };
    const borrowed = shellValueFromBytes(Uint8Array.of(128), allocation);
    const original = commandContract.createCommandArguments([borrowed], allocation);
    const baseline = charged;
    active = true;
    let caught = false;
    try { original.withValues([borrowed, Uint8Array.of(255), Uint8Array.of(254)]); }
    catch (error) { caught = true; assert.equal(error, reason); }
    assert.equal(caught, true);
    assert.equal(charged, baseline);
    assert.equal(original.values[0], borrowed);
    active = false;
    assert.deepEqual(Array.from(original.bytes(0)!), [128]);
  });
}

test("owned command rollback attempts nested then metadata cleanup and preserves falsey failures", () => {
  const released: number[] = [];
  let active = false;
  let reservations = 0;
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() {
      const ordinal = active ? ++reservations : 0;
      if (ordinal === 3) throw undefined;
      return {
        commit() {},
        release() { released.push(ordinal); if (ordinal === 2) throw false; if (ordinal === 1) throw 0; },
      };
    },
  };
  const original = commandContract.createCommandArguments([], allocation);
  active = true;
  assert.throws(() => original.withValues([Uint8Array.of(255), Uint8Array.of(254)]), error =>
    error instanceof AggregateError && error.errors.length === 3 &&
    error.errors[0] === undefined && error.errors[1] === false && error.errors[2] === 0);
  assert.deepEqual(released, [2, 1]);
});

test("owned command rollback does not release a failed primitive reservation twice", () => {
  const released: number[] = [];
  let active = false;
  let reservations = 0;
  const reason = new Error("byte commit failed");
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() {
      const ordinal = active ? ++reservations : 0;
      return { commit() { if (ordinal === 3) throw reason; }, release() { released.push(ordinal); } };
    },
  };
  const original = commandContract.createCommandArguments([], allocation);
  active = true;
  assert.throws(() => original.withValues([Uint8Array.of(255), Uint8Array.of(254)]), error => error === reason);
  assert.deepEqual(released, [3, 2, 1]);
});

test("owned command join admits parts scratch before populating it", () => {
  let active = false;
  let pushes = 0;
  let pushesAtDenial: number | undefined;
  const reason = new Error("join scratch denied");
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve() {
      if (active) { pushesAtDenial = pushes; throw reason; }
      return { commit() {}, release() {} };
    },
  };
  const original = commandContract.createCommandArguments(["first", shellValueFromBytes(Uint8Array.of(255)), "last"], allocation);
  const originalPush = Array.prototype.push;
  let observed: unknown;
  try {
    Array.prototype.push = function (...items) { if (active) pushes++; return Reflect.apply(originalPush, this, items); };
    active = true;
    original.join(":");
  } catch (error) { observed = error; }
  finally { active = false; Array.prototype.push = originalPush; }
  assert.equal(observed, reason);
  assert.equal(pushesAtDenial, 0);
});

test("owned command join releases temporary charges on both text success and byte denial", () => {
  let charged = 0;
  let active = false;
  let reservations = 0;
  const reason = new Error("join byte reservation denied");
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve(bytes) {
      if (active && ++reservations === 3) throw reason;
      charged += bytes;
      let released = false;
      return { commit() {}, release() { assert.equal(released, false); released = true; charged -= bytes; } };
    },
  };
  const text = commandContract.createCommandArguments(["first", "last"], allocation);
  const raw = commandContract.createCommandArguments(["first", shellValueFromBytes(Uint8Array.of(255))], allocation);
  const baseline = charged;
  assert.equal(text.join(":"), "first:last");
  assert.equal(charged, baseline);
  active = true;
  assert.throws(() => raw.join(":"), error => error === reason);
  assert.equal(charged, baseline);
});

test("owned command captures caller replacement after metadata admission", () => {
  const input = ["before"];
  const owned = commandContract.createCommandArguments(input, {
    assertOpen() {},
    reserve() { input[0] = "after"; return { commit() {}, release() {} }; },
  });
  assert.deepEqual(owned.args, ["after"]);
});

test("owned command join keeps a borrowed single value and releases its scratch", () => {
  const raw = shellValueFromBytes(Uint8Array.of(255));
  let charged = 0;
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve(bytes) {
      charged += bytes;
      return { commit() {}, release() { charged -= bytes; } };
    },
  };
  const original = commandContract.createCommandArguments([raw], allocation);
  const empty = commandContract.createCommandArguments([], allocation);
  const baseline = charged;
  assert.equal(original.join(":"), raw);
  assert.equal(empty.join(":"), "");
  assert.equal(charged, baseline);
});

test("owned command join rolls back new output when final scratch release fails", () => {
  let charged = 0;
  let active = false;
  let reservations = 0;
  const released: number[] = [];
  const allocation: ValueAllocation = {
    assertOpen() {},
    reserve(bytes) {
      const ordinal = active ? ++reservations : 0;
      charged += bytes;
      return {
        commit() {},
        release() { released.push(ordinal); charged -= bytes; if (ordinal === 1) throw false; },
      };
    },
  };
  const original = commandContract.createCommandArguments(["first", shellValueFromBytes(Uint8Array.of(255))], allocation);
  const baseline = charged;
  active = true;
  let caught = false;
  try { original.join(":"); }
  catch (error) { caught = true; assert.equal(error, false); }
  assert.equal(caught, true);
  assert.equal(charged, baseline);
  assert.deepEqual(released, [2, 1, 3]);
});

for (const mutation of ["replace", "truncate"] as const) {
  test(`owned command join freezes scratch before commit can ${mutation}`, () => {
    let active = false;
    let observed = false;
    let frozen = false;
    let changed = false;
    const allocation: ValueAllocation = {
      assertOpen() {},
      reserve() {
        return {
          commit(value) {
            if (!active || observed || !Array.isArray(value)) return;
            observed = true;
            frozen = Object.isFrozen(value);
            changed = mutation === "replace" ? Reflect.set(value, "0", "INJECTED") : Reflect.set(value, "length", 1);
          },
          release() {},
        };
      },
    };
    const raw = shellValueFromBytes(Uint8Array.of(255));
    const original = commandContract.createCommandArguments(["A", raw, "B"], allocation);
    active = true;
    const joined = original.join(":");
    active = false;
    assert.deepEqual(Array.from(shellValueBytes(joined)), [65, 58, 255, 58, 66]);
    assert.deepEqual(original.values, ["A", raw, "B"]);
    assert.equal(observed, true);
    assert.equal(frozen, true);
    assert.equal(changed, false);
  });
}

test("registry supports explicit registration, lookup, replacement, and removal", () => {
  const registry = new CommandRegistry([success]);
  assert.ok(registry.has("example"));
  assert.equal(registry.get("missing"), undefined);
  assert.throws(() => registry.register(success), /already registered/u);
  registry.register({ name: "example", execute: () => ({ exitCode: 1 }) }, { replace: true });
  assert.deepEqual(registry.get("example")?.execute(makeContext()), { exitCode: 1 });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.unregister("example"), true);
  assert.equal(registry.unregister("example"), false);
  assert.equal(registry.has("example"), false);
});

test("registry snapshots definitions and does not expose its backing collection", () => {
  const command = { ...success };
  const registry = new CommandRegistry([command]);
  command.name = "changed";
  assert.equal(registry.get("example")?.name, "example");
  assert.ok(Object.isFrozen(registry.get("example")));
  assert.notEqual(registry.list(), registry.list());
});

test("registry rejects empty, NUL, whitespace, and path-based names", () => {
  const registry = new CommandRegistry();
  for (const name of ["", "two words", "a\nb", "a\0b", "/bin/sh", "./echo"]) {
    assert.throws(() => registry.register({ ...success, name }), TypeError);
  }
  registry.register({ ...success, name: "my-command.v2" });
  registry.register({ ...success, name: "[" });
});

test("exit statuses follow the 0 through 255 shell range", () => {
  assert.equal(validateExitCode(0), 0);
  assert.equal(validateExitCode(255), 255);
  for (const code of [-1, 256, 0.1, NaN, Infinity]) assert.throws(() => validateExitCode(code), RangeError);
});

test("middleware nests in registration order and shares command state", async () => {
  const events: string[] = [];
  const first: Middleware = async (context, next) => {
    events.push("first:before");
    context.env.FIRST = "set";
    const result = await next();
    events.push("first:after");
    return result;
  };
  const second: Middleware = async (context, next) => {
    events.push("second:before");
    context.cwd = "/work";
    const result = await next();
    events.push("second:after");
    return result;
  };
  const run = composeMiddleware([first, second], (context) => {
    events.push("command");
    assert.equal(context.env.FIRST, "set");
    assert.equal(context.cwd, "/work");
    return { exitCode: 7 };
  });
  assert.deepEqual(await run(makeContext()), { exitCode: 7 });
  assert.deepEqual(events, ["first:before", "second:before", "command", "second:after", "first:after"]);
});

test("middleware can short-circuit without invoking a command", async () => {
  const run = composeMiddleware([() => ({ exitCode: 126 })], () => {
    throw new Error("must not run");
  });
  assert.deepEqual(await run(makeContext()), { exitCode: 126 });
});

test("middleware rejects repeated next calls", async () => {
  const run = composeMiddleware([async (_context, next) => {
    await next();
    return next();
  }], success.execute);
  await assert.rejects(run(makeContext()), /only be called once/u);
});

test("middleware errors propagate and cancellation prevents dispatch", async () => {
  const failure = new Error("command failed");
  const run = composeMiddleware([], () => { throw failure; });
  await assert.rejects(run(makeContext()), (error) => error === failure);
  const context = { ...makeContext(), signal: AbortSignal.abort(failure) };
  await assert.rejects(composeMiddleware([], success.execute)(context), (error) => error === failure);
});

test("middleware dispatch state is independent for concurrent invocations", async () => {
  const run = composeMiddleware([async (_context, next) => {
    await Promise.resolve();
    return next();
  }], success.execute);
  assert.deepEqual(await Promise.all([run(makeContext()), run(makeContext())]),
    [{ exitCode: 0 }, { exitCode: 0 }]);
});

test("plugin contract supports async setup, middleware, and filesystem factories", async () => {
  const commands = new CommandRegistry();
  const middleware: Middleware[] = [];
  const schemes: string[] = [];
  const host: PluginHost = {
    commands,
    use(handler) { middleware.push(handler); },
    registerFileSystem(scheme) { schemes.push(scheme); },
  };
  const plugin: VirtualShellPlugin = {
    name: "example",
    async setup(target) {
      target.commands.register(success);
      target.use((_context, next) => next());
      target.registerFileSystem("memory", () => makeContext().fs);
    },
  };
  await plugin.setup(host);
  assert.ok(commands.has("example"));
  assert.equal(middleware.length, 1);
  assert.deepEqual(schemes, ["memory"]);
  assert.deepEqual(ACCESS_MODES, { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 });
});
