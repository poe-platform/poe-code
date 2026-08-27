import assert from "node:assert/strict";
import test from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, collectBytes, toByteSource, writeBytes, type CommandInvokeOptions } from "../../../src/index.js";

for (const [source, expected] of [
  ["LOCAL=hidden; export PUBLIC=parent; PREFIX=temporary env -i A=first A=last B=two env -u A; printf '<%s><%s><%s>\\n' \"$LOCAL\" \"$PUBLIC\" \"${PREFIX-unset}\"", "B=two\n<hidden><parent><unset>\n"],
  ["export PUBLIC=parent; env -u PUBLIC sh -c 'printf \"<%s>\\n\" \"${PUBLIC-unset}\"'; printf '%s\\n' \"$PUBLIC\"", "<unset>\nparent\n"],
  ["PRIVATE=local; export PUBLIC=parent; env -i sh -c 'printf \"<%s><%s>\\n\" \"${PUBLIC-unset}\" \"${PRIVATE-unset}\"'", "<unset><unset>\n"],
  ["printf 'é\\n' | env -i env -i cat | wc -c", "3\n"],
  ["env -i A=one B=two A=replaced env -u absent", "B=two\nA=replaced\n"],
] as const) test(`actual env shell chain: ${source}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { INHERITED: "secret" } }).use(agentCommands());
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

for (const mode of ["omitted", "false", "true"] as const) test(`actual invoker keeps legacy merge boundary: ${mode}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { PARENT: "value" } }).use(agentCommands());
  const observed: Record<string, string>[] = [];
  shell.register({ name: "start", async execute(context) {
    const original = { ...context.env };
    const options: CommandInvokeOptions = { env: { CHILD: "only" }, ...(mode === "omitted" ? {} : { replaceEnv: mode === "true" }) };
    const result = await context.invoke!("capture", ["literal arg"], options);
    assert.deepEqual({ ...context.env }, original);
    return result;
  } });
  shell.register({ name: "capture", execute(context) {
    observed.push({ ...context.env });
    assert.deepEqual(context.args, ["literal arg"]);
    context.env.PARENT = "modified child";
    return { exitCode: 7 };
  } });
  try {
    assert.equal((await shell.exec("LOCAL=private; start")).exitCode, 7);
    assert.deepEqual(observed, [mode === "true" ? { CHILD: "only" } : { PARENT: "value", PWD: "/", CHILD: "only" }]);
    assert.equal((await shell.exec("printf '%s' \"$PARENT\"")).stdout, "value");
  } finally { await shell.dispose(); }
});

test("actual env -C middleware sees exact child map and shared virtual FS/stdin", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/work/child");
  await fs.symlink("child", "/work/alias");
  const shell = new Shell({ fs, cwd: "/work", env: { SECRET: "parent" } }).use(agentCommands());
  const observed: unknown[] = [];
  shell.use(async (context, next) => {
    if (context.command === "capture") observed.push({ cwd: context.cwd, env: { ...context.env }, args: context.args });
    return next();
  });
  shell.register({ name: "capture", async execute(context) {
    const bytes = await collectBytes(context.stdin, { maxBytes: 16, signal: context.signal });
    await context.fs.writeFile(`${context.cwd}/data`, bytes, { signal: context.signal });
    await writeBytes(context.stdout, Buffer.from(context.cwd), context.signal);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("env -i -C alias CHILD=yes capture 'literal arg'", { stdin: Uint8Array.from([0, 255, 195, 169]) });
    assert.equal(result.stdout, "/work/child"); assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed, [{ cwd: "/work/child", env: { CHILD: "yes" }, args: ["literal arg"] }]);
    assert.deepEqual(await fs.readFile("/work/child/data"), Uint8Array.from([0, 255, 195, 169]));
    assert.equal((await shell.exec("pwd; printf '%s' \"$SECRET\"")).stdout, "/work\nparent");
  } finally { await shell.dispose(); }
});

for (const [source, limits, limit] of [
  ["env -i env -i env -i true", { maxCommands: 3 }, "maxCommands"],
  ["env -i printf abcdef", { maxOutputBytes: 3 }, "maxOutputBytes"],
  ["env -i sh -c 'while true; do :; done'", { maxLoopIterations: 2 }, "maxLoopIterations"],
] as const) test(`actual env retains ${limit}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try { await assert.rejects(shell.exec(source, { limits }), error => error instanceof ShellLimitError && error.limit === limit); }
  finally { await shell.dispose(); }
});

test("actual replacement invoker forwards supplied stdin without reviving parent environment", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { SECRET: "secret" } }).use(agentCommands());
  shell.register({ name: "replace", execute(context) { return context.invoke!("env", ["cat"], { replaceEnv: true, stdin: toByteSource("replacement") }); } });
  try { const result = await shell.exec("replace", { stdin: "parent input" }); assert.equal(result.stdout, "replacement"); assert.equal(result.exitCode, 0, result.stderr); }
  finally { await shell.dispose(); }
});
