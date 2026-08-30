import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBytes, toByteSource, writeText } from "../../src/contracts/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import type { ShellExecOptions, ShellInvokeOptions } from "../../src/shell/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createSearchCommands } from "../../src/commands/search/index.js";
import { setup } from "./helpers.js";

function originSetup() {
  const fixture = setup();
  fixture.commands.register({ name: "origin", async execute(context) {
    await writeText(context.stdout, `${String(context.stdinIsDefault)}\n`);
    return { exitCode: 0 };
  } });
  fixture.commands.register({ name: "drain", async execute(context) {
    await collectBytes(context.stdin, { maxBytes: 1024, signal: context.signal });
    return { exitCode: 0 };
  } });
  return fixture;
}

for (const [name, options, expected] of [
  ["omitted", {}, true],
  ["empty string", { stdin: "" }, false],
  ["empty bytes", { stdin: new Uint8Array() }, false],
  ["empty stream", { stdin: toByteSource("") }, false],
] satisfies [string, ShellExecOptions, boolean][]) {
  test(`stdin origin: exec ${name}`, async () => {
    const { shell } = originSetup();
    const result = await shell.exec("origin", options);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${expected}\n`);
  });
}

for (const [source, expected] of [
  ["origin | pass", "true\n"],
  [": | origin", "false\n"],
  [": | pass | origin", "false\n"],
  ["origin <empty", "false\n"],
  ["origin <<END\nEND", "false\n"],
  ["origin <<'END'\nEND", "false\n"],
  ["origin <<< ''", "false\n"],
  ["origin 3<empty 0<&3", "false\n"],
  ["origin 3<&0 <empty 0<&3", "true\n"],
  ["origin <empty 3<&0 0<&3", "false\n"],
  ["origin 3<&0 0<&- 0<&3", "true\n"],
  ["origin 3<empty 0<&3 3<&-", "false\n"],
  ["origin 0<&-", "false\n"],
  ["origin 0>out", "false\n"],
  ["origin 2>out 3>other", "true\n"],
  ["{ origin; }; (origin)", "true\ntrue\n"],
  ["{ origin; } <empty; origin", "false\ntrue\n"],
  ["(origin) <empty", "false\n"],
  ["func() { origin; }; func; func <empty; origin", "true\nfalse\ntrue\n"],
  ["func() { origin; }; : | func", "false\n"],
  ["say \"$(origin)\"", "true\n"],
  ["{ say \"$(origin)\"; } <empty", "false\n"],
  ["say \"$(origin <empty)\"; origin", "false\ntrue\n"],
  ["{ : | origin 0<&3; } 3<&0", "true\n"],
  ["{ : | origin 0<&3; } 3<empty", "false\n"],
  ["{ origin <&3; } 3<<END\nEND", "false\n"],
  ["{ origin <&3; } 3<<< ''", "false\n"],
  ["{ origin 0<&3; } 3<&0 <empty", "true\n"],
  ["{ origin 0<&3; } <empty 3<&0", "false\n"],
  ["{ drain <&3; origin <&3; origin; } 3<empty", "false\ntrue\n"],
  ["{ origin; } 0<&-", "false\n"],
] satisfies [string, string][]) {
  test(`stdin origin: ${source}`, async () => {
    const { shell, fs } = originSetup();
    await fs.writeFile("/empty", new Uint8Array());
    const result = await shell.exec(source, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

test("stdin origin: detection never reads supplied input", async () => {
  const { shell } = originSetup();
  let reads = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() {
    return { async next() { reads++; throw new Error("unexpected input read"); } };
  } };
  const result = await shell.exec("origin; origin | pass", { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "false\nfalse\n");
  assert.equal(reads, 0);
});

test("stdin origin: zero chunks and EOF never change explicit origin", async () => {
  const { shell, commands } = originSetup();
  commands.register({ name: "check-drain", async execute(context) {
    assert.equal(context.stdinIsDefault, false);
    const bytes = await collectBytes(context.stdin, { maxBytes: 1024, signal: context.signal });
    assert.equal(new TextDecoder().decode(bytes), "data");
    assert.equal(context.stdinIsDefault, false);
    return { exitCode: 0 };
  } });
  const stdin = (async function* () {
    yield new Uint8Array();
    yield new Uint8Array();
    yield new TextEncoder().encode("data");
  })();
  const result = await shell.exec("origin; check-drain; origin; drain; origin", { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "false\nfalse\nfalse\n");
});

test("stdin origin: externally exhausted stream remains explicit", async () => {
  const { shell } = originSetup();
  const stdin = (async function* () { yield new Uint8Array(); })();
  await collectBytes(stdin, { maxBytes: 1024 });
  assert.equal((await shell.exec("origin; drain; origin", { stdin })).stdout, "false\nfalse\n");
  assert.equal((await shell.exec("drain; origin")).stdout, "true\n");
});

test("stdin origin: duplicated descriptors share cursor without changing origin", async () => {
  const { shell, fs } = originSetup();
  await fs.writeFile("/input", new TextEncoder().encode("first\nsecond\n"));
  const result = await shell.exec("{ read -r first <&3; say \"$first\"; pass <&4; origin <&3; } 3<input 4<&3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "first\nsecond\nfalse\n");
});

test("stdin origin: closed input retains bad-descriptor failures", async () => {
  const { shell } = originSetup();
  const result = await shell.exec("{ origin; drain; } 0<&-");
  assert.equal(result.stdout, "false\n");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Bad file descriptor/u);
  const duplicate = await shell.exec("{ origin 3<&0; } 0<&-");
  assert.equal(duplicate.exitCode, 1);
  assert.equal(duplicate.stdout, "");
});

for (const defaultInput of [true, false]) {
  test(`stdin origin: nested invocation from default=${defaultInput}`, async () => {
    const { shell, commands } = originSetup();
    commands.register({ name: "delegate", async execute(context) {
      assert.ok(context.invoke);
      await context.invoke("origin", []);
      await context.invoke("origin", [], { stdinIsDefault: !defaultInput });
      await context.invoke("origin", [], { stdin: toByteSource("") });
      await context.invoke("origin", [], { stdin: toByteSource(new Uint8Array()) });
      await context.invoke("origin", [], { stdin: context.stdin });
      const clone = { ...context };
      const forwarded: ShellInvokeOptions = {
        stdin: clone.stdin,
        ...(clone.stdinIsDefault === undefined ? {} : { stdinIsDefault: clone.stdinIsDefault }),
      };
      await context.invoke("origin", [], forwarded);
      await context.invoke("origin", [], { stdin: toByteSource(""), stdinIsDefault: true });
      await context.invoke("origin", [], { stdin: context.stdin, stdinIsDefault: false });
      return context.invoke("origin", []);
    } });
    const result = await shell.exec("delegate", defaultInput ? {} : { stdin: "" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, [defaultInput, defaultInput, false, false, false, defaultInput, true, false, defaultInput].map(value => `${value}\n`).join(""));
  });
}

test("stdin origin: nested functions preserve saved descriptors and replacement origin", async () => {
  const { shell, commands } = originSetup();
  commands.register({ name: "delegate", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("func", [], { stdin: toByteSource("") });
  } });
  const result = await shell.exec("func() { origin; origin <&3; }; delegate 3<&0");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "false\ntrue\n");
});

test("stdin origin: middleware and transparent clones retain provenance", async () => {
  const { shell } = originSetup();
  const observed: (boolean | undefined)[] = [];
  shell.use(async (context, next) => {
    const clone = { ...context };
    if (clone.command === "origin") observed.push(clone.stdinIsDefault);
    return next();
  });
  await shell.exec("origin; : | origin");
  assert.deepEqual(observed, [true, false]);
});

test("stdin origin: forwarding changed clones requires explicit invocation options", async () => {
  const { shell, commands } = originSetup();
  commands.register({ name: "delegate", async execute(context) {
    assert.ok(context.invoke);
    const clone = { ...context, stdin: toByteSource(""), stdinIsDefault: false };
    assert.ok(clone.invoke);
    await clone.invoke("origin", []);
    return clone.invoke("origin", [], { stdin: clone.stdin, stdinIsDefault: clone.stdinIsDefault });
  } });
  const result = await shell.exec("delegate");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "true\nfalse\n");
});

for (const [source, options, expectedCode, expectedOutput] of [
  ["rg match", {}, 0, "matched:match\n"],
  ["rg match", { stdin: "" }, 1, ""],
  ["rg match", { stdin: new Uint8Array() }, 1, ""],
  ["rg match", { stdin: toByteSource("") }, 1, ""],
  ["printf '' | rg match", {}, 1, ""],
  ["printf '' | rg -e match", {}, 1, ""],
  ["printf '' | rg -f .patterns/patterns", {}, 1, ""],
  ["printf '' | rg match -", {}, 1, ""],
  ["rg match <empty", {}, 1, ""],
  ["rg match <<END\nEND", {}, 1, ""],
  ["rg match <<< ''", {}, 1, ""],
  ["rg match 3<empty 0<&3", {}, 1, ""],
  ["rg match 3<&0 <empty 0<&3", {}, 0, "matched:match\n"],
  ["rg match <empty 3<&0 0<&3", {}, 1, ""],
  ["env rg match", {}, 0, "matched:match\n"],
  ["printf '' | env rg match", {}, 1, ""],
  ["printf '' | rg match matched", {}, 0, "match\n"],
] satisfies [string, ShellExecOptions, number, string][]) {
  test(`stdin origin: rg integration ${source} supplied=${options.stdin !== undefined}`, async () => {
    const { shell, fs, commands } = setup();
    for (const command of [...createStandardCommands(), ...createSearchCommands()]) commands.register(command);
    await fs.writeFile("/matched", new TextEncoder().encode("match\n"));
    await fs.writeFile("/empty", new Uint8Array());
    await fs.mkdir("/.patterns");
    await fs.writeFile("/.patterns/patterns", new TextEncoder().encode("match\n"));
    const result = await shell.exec(source, { ...options, signal: AbortSignal.timeout(2000) });
    assert.equal(result.exitCode, expectedCode, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expectedOutput);
  });
}
