import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { Shell } from "../../../../src/shell/shell.js";
import { browserCommands } from "../../../../src/browser.js";
import type { ShellExtension, ShellExtensionContext, PreparedShellChild, ShellListTerminatorContext } from "../../../../src/shell/extensions.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { FsError } from "../../../../src/contracts/errors.js";
import { negationJobReference } from "../jobs/negation53-reference.js";
import { extendedNegationJobReference } from "../jobs/negation-extended53-reference.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function gated() {
  const gate = deferred();
  const entered = deferred();
  const extension: ShellExtension = { name: "controller", create: () => ({ builtins: [
    { name: "gate", async execute(context) {
      entered.resolve();
      const abort = () => gate.resolve();
      context.signal.addEventListener("abort", abort, { once: true });
      try { await gate.promise; context.signal.throwIfAborted(); return 0; }
      finally { context.signal.removeEventListener("abort", abort); }
    } },
    { name: "release", execute: () => { gate.resolve(); return 0; } },
  ] }) };
  return { gate, entered, extension };
}

for (const producer of [
  "{ gate; printf CHILD; } &",
  "printf input | { { gate; printf CHILD; } & }",
  "{ gate; printf CHILD; } & wait",
]) test(`substitution observes inherited capture retirement: ${producer}`, { timeout: 2000 }, async context => {
  const control = gated();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension] }).use(browserCommands());
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const execution = shell.exec(`value=$(${producer}); printf '<%s>' "$value"`);
  await control.entered.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  control.gate.resolve();
  const result = await execution;
  assert.equal(result.stdout, "<CHILD>");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const scenario of [
  { name: "terminal command", source: "gate >/file", holds: false, suffix: "" },
  { name: "terminal pipeline", source: "printf '' | gate >/file", holds: false, suffix: "" },
  { name: "explicit command alias", source: "{ gate; printf ALIAS >&3; } 3>&1 >/file", holds: true, suffix: "ALIAS" },
  { name: "last pipeline stage alias", source: "printf '' | { gate; printf ALIAS >&3; } 3>&1 >/file", holds: true, suffix: "ALIAS" },
  { name: "nonterminal AND command", source: "gate >/file && printf ALIAS", holds: true, suffix: "ALIAS" },
  { name: "nonterminal OR command", source: "{ gate; false; } >/file || printf ALIAS", holds: true, suffix: "ALIAS" },
  { name: "AND command retains restoration despite last position", source: ": && gate >/file", holds: true, suffix: "" },
  { name: "nested group EXIT trap", source: "{ trap 'printf EXIT' EXIT; gate >/file; }", holds: true, suffix: "EXIT" },
  { name: "pipeline stage nested EXIT trap", source: "printf '' | { trap 'printf EXIT' EXIT; gate >/file; }", holds: true, suffix: "EXIT" },
  { name: "nested function continuation", source: "{ f() { gate >/file; printf ALIAS; }; f; }", holds: true, suffix: "ALIAS" },
  { name: "closed duplicate", source: "gate 3>&1 3>&- >/file", holds: false, suffix: "" },
  { name: "different stage surviving alias", source: "{ gate; printf ALIAS >&3; } >/file | : 3>&- >/other", holds: true, suffix: "ALIAS", inheritedAlias: true },
]) test(`terminal descriptor ownership: ${scenario.name}`, { timeout: 2500 }, async context => {
  const control = gated();
  const captured = deferred();
  const parent = deferred();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("terminal ownership safety deadline")), 1200);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), trapExtension(), control.extension] }).use(browserCommands());
  shell.register({ name: "captured", execute() { captured.resolve(); return { exitCode: 0 }; } });
  shell.register({ name: "continued", execute() { parent.resolve(); control.gate.resolve(); return { exitCode: 0 }; } });
  const running: { execution?: ReturnType<Shell["exec"]> } = {};
  context.after(async () => {
    clearTimeout(timer);
    controller.abort(new Error("terminal ownership teardown"));
    control.gate.resolve();
    await running.execution?.catch(() => undefined);
    await shell.dispose();
  });
  const body = `${scenario.source} & printf CAPTURE; captured`;
  const execution = running.execution = shell.exec(`value=$(${scenario.inheritedAlias ? `{ ${body}; } 3>&1` : body}); continued; printf '<%s>' "$value"`, { signal: controller.signal });
  const premature = execution.then(() => { throw new Error("execution ended before ownership checkpoint"); });
  void premature.catch(() => undefined);
  await Promise.race([Promise.all([control.entered.promise, captured.promise]), premature]);
  if (scenario.holds) {
    let continued = false;
    void parent.promise.then(() => { continued = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(continued, false);
    control.gate.resolve();
  } else await Promise.race([parent.promise, premature]);
  const result = await execution;
  assert.equal(result.stdout, `<CAPTURE${scenario.suffix}>`);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const reason of [false, 0, "", null]) for (const pipeline of [false, true]) {
  test(`retired collector keeps redirected child cleanup owned: pipeline=${pipeline}, reason=${String(reason)}`, { timeout: 2000 }, async context => {
    const control = gated();
    const parent = deferred();
    const controller = new AbortController();
    const memory = createMemoryFileSystem();
    let opens = 0;
    let closes = 0;
    const fs = new Proxy(memory, { get(target, key) {
      if (key === "open") return async (...args: Parameters<typeof memory.open>) => {
        const descriptor = await memory.open(...args);
        opens++;
        return new Proxy(descriptor, { get(resource, property) {
          if (property === "close") return async () => { closes++; await resource.close(); };
          const value: unknown = Reflect.get(resource, property, resource);
          return typeof value === "function" ? value.bind(resource) : value;
        } });
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = new Shell({ fs, extensions: [jobsExtension(), control.extension] }).use(browserCommands());
    shell.register({ name: "continued", execute() { parent.resolve(); return { exitCode: 0 }; } });
    const execution = shell.exec(`value=$(${pipeline ? "printf '' | " : ""}gate >/file &); continued`, { signal: controller.signal });
    const rejected = assert.rejects(execution, failure => Object.is(failure, reason));
    context.after(async () => { controller.abort(reason); control.gate.resolve(); await execution.catch(() => undefined); await shell.dispose(); });
    await Promise.race([Promise.all([control.entered.promise, parent.promise]), execution]);
    assert.equal(opens, 1);
    assert.equal(closes, 0);
    controller.abort(reason);
    await rejected;
    assert.equal(closes, 1);
  });
}

for (const command of ["true >/file", "{ true >/file; } & wait \"$!\"", "true >/file & wait \"$!\""]) {
  test(`terminal descriptor ownership preserves diagnosed close failure: ${command}`, async context => {
    const memory = createMemoryFileSystem();
    let closes = 0;
    const fs = new Proxy(memory, { get(target, key) {
      if (key === "open") return async (...args: Parameters<typeof memory.open>) => {
        const descriptor = await memory.open(...args);
        return new Proxy(descriptor, { get(resource, property) {
          if (property === "close") return async () => { closes++; await resource.close(); throw new FsError("EPIPE"); };
          const value: unknown = Reflect.get(resource, property, resource);
          return typeof value === "function" ? value.bind(resource) : value;
        } });
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = new Shell({ fs, extensions: [jobsExtension()] }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`${command}; printf 'after:%s' "$?"`);
    assert.equal(result.stdout, "after:141");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(closes, 1);
  });
}

test("no-undo completion retains error-before-exit lifecycle ordering", async context => {
  const events: string[] = [];
  const observer = (child: boolean): ReturnType<ShellExtension["create"]> => ({
    builtins: [],
    fork: () => observer(true),
    event(event) { if (child && (event === "error" || event === "exit")) events.push(event); },
  });
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), { name: "ordering", create: () => observer(false) }] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('false & wait "$!"');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(events, ["error", "exit"]);
});

for (const id of [1, 2, 3, 4]) {
  const reference = negationJobReference(id);
  test(`measured Bash 5.3 asynchronous negation: ${reference.name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(reference.source, { stdin: reference.stdin, env: { LC_ALL: "C" } });
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
    assert.equal(result.exitCode, reference.status);
  });
}

for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const reference = extendedNegationJobReference(id);
  test(`measured Bash 5.3 extended asynchronous negation: ${reference.name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(reference.source, { stdin: reference.stdin, env: { LC_ALL: "C" } });
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
    assert.equal(result.exitCode, reference.status);
  });
}

for (const command of ["true", "false"]) for (const restoring of [false, true]) {
  test(`source control: negated completion separates raw PIPESTATUS from EXIT: ${restoring ? "restoring " : ""}${command}`, async context => {
    const events: { event: string; status: number; raw: unknown }[] = [];
    const observer = (child: boolean): ReturnType<ShellExtension["create"]> => ({
      builtins: [], fork: () => observer(true),
      event(event, invocation) {
        if (child && (event === "error" || event === "exit")) events.push({ event, status: invocation.status, raw: invocation.bindings.get("PIPESTATUS", 0) });
      },
    });
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension(), jobsExtension(), { name: "negation-observer", create: () => observer(false) }] }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -e; ${restoring ? ": && " : ""}! ${command} & wait "$!"`);
    const rawStatus = command === "true" ? 0 : 1;
    const status = restoring ? Number(rawStatus === 0) : rawStatus;
    assert.equal(result.exitCode, status);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(events, [{ event: "exit", status, raw: command === "true" ? "0" : "1" }]);
  });
}

for (const pipefail of [false, true]) for (const commands of ["false | true", "true | false"]) {
  test(`source control: negated pipeline preserves raw stage vector: pipefail=${pipefail} ${commands}`, async context => {
    const exits: { status: number; raw: unknown[] }[] = [];
    const observer = (scope: string): ReturnType<ShellExtension["create"]> => ({
      builtins: [], fork: scope => observer(scope),
      event(event, invocation) {
        if (scope === "subshell" && event === "exit") exits.push({ status: invocation.status, raw: [invocation.bindings.get("PIPESTATUS", 0), invocation.bindings.get("PIPESTATUS", 1)] });
      },
    });
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension(), jobsExtension(), { name: "pipeline-negation", create: () => observer("root") }] }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -e; ${pipefail ? "set -o pipefail; " : ""}! ${commands} & wait "$!"`);
    const status = commands === "false | true" && !pipefail ? 0 : 1;
    assert.equal(result.exitCode, status);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(exits, [{ status, raw: commands === "false | true" ? ["1", "0"] : ["0", "1"] }]);
  });
}

for (const command of ["true", "false"]) test(`source control: EXIT override is not negated a second time: ${command}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), trapExtension()] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`f() { trap 'exit 7' EXIT; ${command}; }; ! f & wait "$!"`);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

for (const command of ["! exit 7", ": && ! exit 7", "! { exit 7; }"]) {
  test(`source control: explicit exit bypasses normal pipeline inversion: ${command}`, async context => {
    const exits: number[] = [];
    const observer = (child: boolean): ReturnType<ShellExtension["create"]> => ({
      builtins: [], fork: () => observer(true),
      event(event, invocation) { if (child && event === "exit") exits.push(invocation.status); },
    });
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), { name: "explicit-exit", create: () => observer(false) }] }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`${command} & wait "$!"`);
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(exits, [7]);
  });
}

test("captured generic list and parameter hooks execute without a jobs-named extension", async context => {
  const extension: ShellExtension = {
    name: "custom-syntax",
    syntax: { listTerminators: [{ operator: "&" }], specialParameters: [{ name: "!" }] },
    create: () => ({
      builtins: [],
      listTerminators: [{ operator: "&", execute: () => 0 }],
      specialParameters: [{ name: "!", lookup: () => "captured" }],
    }),
  };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("printf forbidden & printf '%s:%s' \"$?\" \"$!\"");
  assert.equal(result.stdout, "0:captured");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("default shell retains unsupported background syntax", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  const result = await shell.exec("true &");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
});

test("syntax callbacks retain their captured receiver", async context => {
  const hook = { name: "!", lookup(_context: ShellExtensionContext) { assert.equal(this, hook); return "receiver"; } };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{
    name: "receiver", syntax: { specialParameters: [{ name: "!" }] },
    create: () => ({ builtins: [], specialParameters: [hook] }),
  }] }).use(browserCommands());
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("printf '%s' \"$!\"")).stdout, "receiver");
});

test("prepared child is single-use with an independent positive process identity", { timeout: 2000 }, async context => {
  let child: PreparedShellChild | undefined;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{
    name: "prepare", syntax: { listTerminators: [{ operator: "&" }] },
    create: () => {
      const cleanups: (() => void | Promise<void>)[] = [];
      return { builtins: [], start(context) { context.registerCleanup(async () => { for (const close of cleanups) await close(); }); },
      listTerminators: [{ operator: "&", async execute(context) {
        child = await context.prepareChild({ signal: context.signal, stdin: "inherit", registerCleanup: cleanup => { cleanups.push(cleanup); } });
        assert.ok(Number.isSafeInteger(child.processId) && child.processId > 0);
        await assert.rejects(context.prepareChild({ signal: context.signal, stdin: "inherit", registerCleanup() {} }), TypeError);
        const first = child.run();
        await assert.rejects(child.run(), TypeError);
        return first;
      } }],
    }; },
  }] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("printf once &");
  assert.equal(result.stdout, "once");
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(child!.run(), TypeError);
});

for (const source of [
  "{ { gate; printf child >&3; } & } 3>out; release; wait; cat out",
  "{ { gate; read -r value <&3; printf '%s' \"$value\"; } & } 3<in; release; wait",
]) test(`prepared child retains resources after parent redirection frame closes: ${source}`, { timeout: 2000 }, async context => {
  const control = gated();
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new TextEncoder().encode("child\n"));
  const shell = new Shell({ fs, extensions: [jobsExtension(), control.extension] }).use(browserCommands());
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec(source);
  assert.equal(result.stdout, "child");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("preparation freezes variables, raw arrays, cwd, positional values and functions before continuation", { timeout: 2000 }, async context => {
  const control = gated();
  const fs = createMemoryFileSystem();
  await fs.mkdir("/child");
  const shell = new Shell({ fs, extensions: [jobsExtension(), arraysExtension(), control.extension] }).use(browserCommands());
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec("value=old; values=($'\\xff'); set -- before; f() { printf oldfn; }; { gate; printf '%s:%s:%s:%s:' \"$value\" \"${values[0]}\" \"$1\" \"$PWD\"; f; value=child; } & value=new; values[0]=new; set -- after; f() { printf newfn; }; cd /child; release; wait; printf ':%s:%s' \"$value\" \"$PWD\"");
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from("old:"), Buffer.from([255]), Buffer.from(":before:/:oldfn:new:/child")]));
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("explicit stdin duplication overrides the asynchronous default without consuming parent stdin twice", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("{ read -r value; printf 'child:%s;' \"$value\"; } <&0 & wait; read -r value; printf 'parent:%s' \"$value\"", { stdin: "first\nsecond\n" });
  assert.equal(result.stdout, "child:first;parent:second");
  assert.equal(result.stderr, "");
});

for (const source of [
  "f() { { exit 7; } & }; f; wait \"$!\"",
  "eval '{ exit 7; } &'; wait \"$!\"",
  ". /launch; wait \"$!\"",
]) test(`functions, eval and source share the shell job owner: ${source}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/launch", new TextEncoder().encode("{ exit 7; } &"));
  const shell = new Shell({ fs, extensions: [jobsExtension()] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 7, result.stderr);
  assert.equal(result.stderr, "");
});

test("isolated child inherits last process identity but cannot wait for its parent's child", { timeout: 2000 }, async context => {
  const control = gated();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension] }).use(browserCommands());
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec("{ gate; exit 7; } & child=$!; ( [[ $! == \"$child\" ]]; printf '%s:' \"$?\"; wait \"$child\" 2>diagnostic; printf '%s:' \"$?\" ); release; wait \"$child\"; printf '%s' \"$?\"");
  assert.equal(result.stdout, "0:127:7");
  assert.equal(result.stderr, "");
});

test("natural EXIT executes before noncancelling child drain (adapted native case 17 controller)", { timeout: 2000 }, async context => {
  const control = gated();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), trapExtension(), control.extension] }).use(browserCommands());
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec("trap 'printf EXIT; release' EXIT; { gate; printf CHILD; } & exit 3");
  assert.equal(result.stdout, "EXITCHILD");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 3);
});

for (const reason of [false, 0, "", null, new Error("root-cancel")]) {
  test(`root cancellation preserves ${String(reason)} and joins the active child`, { timeout: 2000 }, async context => {
    const control = gated();
    const controller = new AbortController();
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension] }).use(browserCommands());
    context.after(() => { control.gate.resolve(); return shell.dispose(); });
    const result = shell.exec("gate & wait", { signal: controller.signal });
    const rejection = assert.rejects(result, error => Object.is(error, reason));
    await control.entered.promise;
    controller.abort(reason);
    await rejection;
  });
}

test("list preparation capability closes when its dispatch returns", async context => {
  let captured: ShellListTerminatorContext | undefined;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{
    name: "late", syntax: { listTerminators: [{ operator: "&" }] },
    create: () => ({ builtins: [], listTerminators: [{ operator: "&", execute(invocation) { captured = invocation; return 0; } }] }),
  }] });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec(": &")).exitCode, 0);
  let registered = false;
  await assert.rejects(captured!.prepareChild({ signal: new AbortController().signal, stdin: "inherit", registerCleanup() { registered = true; } }), TypeError);
  assert.equal(registered, false);
});

test("reentrant cleanup registration failure does not leave child acquisition draining forever", { timeout: 2000 }, async context => {
  let closed: Promise<void> | undefined;
  const reason = new Error("registration failure");
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{
    name: "registration", syntax: { listTerminators: [{ operator: "&" }] },
    create: () => ({ builtins: [], listTerminators: [{ operator: "&", async execute(invocation) {
      await assert.rejects(invocation.prepareChild({ signal: invocation.signal, stdin: "inherit", registerCleanup(close) { closed = Promise.resolve(close()); throw reason; } }), error => error === reason);
      await closed;
      return 0;
    } }] }),
  }] });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec(": &")).exitCode, 0);
});

for (const reason of [undefined, false, 0, "", null, new Error("child failure")]) {
  test(`escaping child start failure retains exact ${String(reason)}`, { timeout: 2000 }, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), {
      name: "child-failure", create: () => ({ builtins: [], fork: () => ({ builtins: [], start() { throw reason; } }) }),
    }] });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(": & wait"), error => Object.is(error, reason));
  });
}

test("asynchronous children share the parent output budget without double charging", async context => {
  for (const limit of [3, 4]) {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()], limits: { maxOutputBytes: limit } }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = shell.exec("printf aa & printf bb & wait");
    if (limit === 3) await assert.rejects(result, ShellLimitError);
    else { const complete = await result; assert.equal(complete.stdoutBytes.length, 4); assert.equal(complete.exitCode, 0); }
  }
});

for (const invocation of ["bash /script", "sh /script", "/script"]) {
  test(`VFS scripts execute ordinary jobs: ${invocation}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/script", new TextEncoder().encode("{ printf child; exit 7; } & wait \"$!\""));
    await fs.chmod("/script", 0o755);
    const shell = new Shell({ fs, extensions: [jobsExtension()] }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(invocation);
    assert.equal(result.stdout, "child");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 7);
  });
}

test("an isolated shell's logical exit does not wait for its asynchronous descendants before parent continuation", { timeout: 3000 }, async context => {
  const control = gated();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error("parent continuation blocked behind descendant cleanup")), 2000);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension] }).use(browserCommands());
  context.after(() => { clearTimeout(deadline); control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec("( { gate; printf CHILD; } & ); printf PARENT; release", { signal: controller.signal });
  assert.equal(result.stdout, "PARENTCHILD");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("waiting for a direct child does not wait for its live grandchild", { timeout: 3000 }, async context => {
  const control = gated();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error("wait included grandchild drain")), 2000);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension] }).use(browserCommands());
  context.after(() => { clearTimeout(deadline); control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec("{ { gate; printf GRANDCHILD; } & exit 7; } & child=$!; wait \"$child\"; printf 'PARENT:%s:' \"$?\"; release", { signal: controller.signal });
  assert.equal(result.stdout, "PARENT:7:GRANDCHILD");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("later EXIT handlers may still launch background children before job admission seals", { timeout: 2000 }, async context => {
  const control = gated();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), trapExtension(), control.extension] }).use(browserCommands());
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec("trap '{ gate; printf CHILD; } & printf EXIT; release' EXIT; exit 3");
  assert.equal(result.stdout, "EXITCHILD");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 3);
});

function executionCleanup(context: ShellExtensionContext, cleanup: () => void | Promise<void>): void {
  const register: unknown = Reflect.get(context, "registerExecutionCleanup");
  assert.equal(typeof register, "function");
  Reflect.apply(register as (cleanup: () => void | Promise<void>) => void, context, [cleanup]);
}

test("execution cleanup drains dynamically enrolled work before capturing output and rejects stale enrollment", async context => {
  let captured: ShellExtensionContext | undefined;
  const events: string[] = [];
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "execution-cleanup", create: () => ({ builtins: [], start(invocation) {
    captured = invocation;
    executionCleanup(invocation, async () => {
      events.push("first");
      await Promise.resolve();
      executionCleanup(invocation, async () => {
        events.push("second");
        await invocation.stdout.write(new TextEncoder().encode("joined"));
        executionCleanup(invocation, () => { events.push("third"); });
      });
    });
  } }) }] });
  context.after(() => shell.dispose());
  const result = await shell.exec(":");
  assert.equal(result.stdout, "joined");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, ["first", "second", "third"]);
  assert.throws(() => executionCleanup(captured!, () => assert.fail("late enrollment executed")), TypeError);
});

for (const reason of [false, 0, "", null]) {
  test(`final execution drain preserves cancellation ${String(reason)} and joins cleanup`, { timeout: 2000 }, async context => {
    const controller = new AbortController();
    const entered = deferred();
    let joined = false;
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "final-drain", create: () => ({ builtins: [], start(invocation) {
      executionCleanup(invocation, async () => {
        entered.resolve();
        await new Promise<void>(resolve => {
          if (invocation.signal.aborted) resolve();
          else invocation.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await Promise.resolve();
        joined = true;
        invocation.signal.throwIfAborted();
      });
    } }) }] });
    context.after(() => shell.dispose());
    const result = shell.exec(":", { signal: controller.signal });
    const failure = assert.rejects(result, error => Object.is(error, reason));
    await entered.promise;
    controller.abort(reason);
    await failure;
    assert.equal(joined, true);
  });
}

for (const reason of [undefined, false, 0, "", null]) {
  test(`escaping primary failure ${String(reason)} survives execution cleanup failure`, async context => {
    let cleaned = false;
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "failed-start", create: () => ({ builtins: [], start(invocation) {
      executionCleanup(invocation, () => { cleaned = true; throw new Error("secondary cleanup"); });
      throw reason;
    } }) }] });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(":"), error => Object.is(error, reason));
    assert.equal(cleaned, true);
  });
}

test("execution drain admits descendant registries created while an earlier registry is draining", { timeout: 2000 }, async context => {
  const control = gated();
  let rootDrainStarted = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension, {
    name: "drain-controller", create: () => ({ builtins: [], fork: () => ({ builtins: [] }), start(invocation) {
      executionCleanup(invocation, async () => {
        rootDrainStarted = true;
        await control.entered.promise;
        control.gate.resolve();
      });
    } }),
  }] }).use(browserCommands());
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const result = await shell.exec("{ gate; { printf DESCENDANT; } & } &");
  assert.equal(rootDrainStarted, true);
  assert.equal(result.stdout, "DESCENDANT");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("disposing an active background child cancels and joins it without manufacturing cleanup failures", { timeout: 2000 }, async context => {
  const control = gated();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension] });
  context.after(() => { control.gate.resolve(); return shell.dispose(); });
  const result = shell.exec("gate &");
  const rejected = assert.rejects(result, { message: "Shell is disposed" });
  await control.entered.promise;
  await shell.dispose();
  await rejected;
});

for (const invocation of ["bash /launch", "sh /launch", "/launch"]) {
  test(`a returning interpreter must not cancel its still-owned background child: ${invocation}`, { timeout: 3000 }, async context => {
    const control = gated();
    const fs = createMemoryFileSystem();
    await fs.writeFile("/launch", new TextEncoder().encode("{ gate; printf CHILD; } &"));
    await fs.chmod("/launch", 0o755);
    const shell = new Shell({ fs, extensions: [jobsExtension(), control.extension] }).use(browserCommands());
    context.after(() => { control.gate.resolve(); return shell.dispose(); });
    const result = await shell.exec(`${invocation}; printf PARENT; release`);
    assert.equal(result.stdout, "PARENTCHILD");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("dispose waits for admitted execution cleanup before settling", { timeout: 2000 }, async context => {
  const entered = deferred();
  const cancelled = deferred();
  const release = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "dispose-drain", create: () => ({ builtins: [], start(invocation) {
    executionCleanup(invocation, async () => {
      invocation.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
      entered.resolve();
      await release.promise;
    });
  } }) }] });
  context.after(() => { release.resolve(); return shell.dispose(); });
  const result = shell.exec(":");
  const rejected = assert.rejects(result, { message: "Shell is disposed" });
  await entered.promise;
  let settled = false;
  const disposal = shell.dispose().then(() => { settled = true; });
  await cancelled.promise;
  assert.equal(settled, false);
  release.resolve();
  await disposal;
  await rejected;
});

test("execution cleanup supplies durable cancellation separately from a completed builtin operation", async context => {
  let checked = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "owner-signal", create: () => ({ builtins: [{
    name: "enroll", execute(invocation) {
      assert.ok(invocation.registerExecutionCleanup);
      const owner = invocation.registerExecutionCleanup(() => {
        assert.equal(invocation.signal.aborted, true);
        assert.equal(owner.aborted, false);
        checked = true;
      });
      return 0;
    },
  }] }) }] });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("enroll; :")).exitCode, 0);
  assert.equal(checked, true);
});

test("execution cleanup retains budget charges for retained failure records", async context => {
  let executions = 0;
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxExpansionFields: 8 }, extensions: [{
    name: "bounded-cleanup", create: () => ({ builtins: [], start(invocation) {
      const enqueue = (): void => executionCleanup(invocation, () => {
        executions++;
        if (executions < 32) enqueue();
        throw false;
      });
      enqueue();
    } }),
  }] });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec(":"), ShellLimitError);
  assert.ok(executions < 32);
});

for (const reason of [undefined, false, 0, "", null]) {
  test(`escaping root start failure ${String(reason)} cancels and joins previously launched work`, { timeout: 2000 }, async context => {
    const control = gated();
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), control.extension, {
      name: "failed-root", create: () => ({ builtins: [], fork: () => ({ builtins: [] }), async start(invocation) {
        await invocation.evaluate("gate &");
        await control.entered.promise;
        throw reason;
      } }),
    }] });
    context.after(() => { control.gate.resolve(); return shell.dispose(); });
    await assert.rejects(shell.exec(":"), error => Object.is(error, reason));
  });
}
