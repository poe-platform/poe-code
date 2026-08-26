import assert from "node:assert/strict";
import test from "node:test";
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
