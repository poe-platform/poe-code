import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, pipeBytes, writeText } from "../../src/index.js";
import type { CommandInvokeOptions } from "../../src/contracts/index.js";
import type { ShellInvokeOptions } from "../../src/shell/types.js";

async function setup() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/other");
  const shell = new Shell({ fs, cwd: "/work", env: { PUBLIC: "parent", A: "ancestor" } }).use(agentCommands());
  shell.register({ name: "report", async execute(context) {
    await writeText(context.stdout, JSON.stringify({ env: context.env, cwd: context.cwd, origin: context.stdinIsDefault, args: context.args }) + "\n");
    return { exitCode: 0 };
  } });
  return { shell, fs };
}

for (const [source, stdout] of [
  ["env -i A=1 B=2 env -u A", "B=2\n"],
  ["env -i A=1 B=2 env -u A | cat", "B=2\n"],
  ["env -i A=1 B=2 env -u A env", "B=2\n"],
  ["TEMP=prefix env -i env", ""],
  ["env -i", ""],
  ["env -i EMPTY= VALUE=a=b env", "VALUE=a=b\nEMPTY=\n"],
] as const) test(`real agent pipeline: ${source}`, async () => {
  const { shell } = await setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, stdout); assert.equal(result.stderr, ""); assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const [source, env, cwd] of [
  ["env -u PUBLIC report", { A: "ancestor", PWD: "/work" }, "/work"],
  ["env -i report", {}, "/work"],
  ["env -i -C /other PWD=caller report", { PWD: "caller" }, "/other"],
  ["env -i -C /other report", {}, "/other"],
] as const) test(`exact exported map: ${source}`, async () => {
  const { shell } = await setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { env, cwd, origin: true, args: [] });
  } finally { await shell.dispose(); }
});

for (const mode of ["bash", "sh"]) test(`private/exported separation at ${mode} startup`, async () => {
  const { shell } = await setup();
  try {
    const result = await shell.exec(`SECRET=private; env -i KEEP=value ${mode} -c 'printf "<%s>|<%s>|<%s>|<%s>\\n" "$PUBLIC" "$SECRET" "$KEEP" "$PWD"'; printf '%s|%s|%s\\n' "$PUBLIC" "$SECRET" "$PWD"`);
    assert.equal(result.stdout, "<>|<>|<value>|</work>\nparent|private|/work\n");
    assert.equal(result.stderr, ""); assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const replaceEnv of [undefined, false, true]) for (const supplied of [false, true]) {
  test(`literal invoke replace=${replaceEnv} supplied=${supplied}`, async () => {
    const { shell } = await setup();
    const env = { ADDED: "yes", PWD: "caller" };
    const options: CommandInvokeOptions = { ...(replaceEnv === undefined ? {} : { replaceEnv }), ...(supplied ? { env } : {}) };
    shell.register({ name: "forward", execute: context => context.invoke!("report", ["", "a b", "$PUBLIC"], options) });
    try {
      const result = await shell.exec("SECRET=private; forward");
      const expected = replaceEnv ? (supplied ? env : {}) : { PUBLIC: "parent", A: "ancestor", ...(supplied ? { ADDED: "yes" } : {}), PWD: "/work" };
      assert.deepEqual(JSON.parse(result.stdout), { env: expected, cwd: "/work", origin: true, args: ["", "a b", "$PUBLIC"] });
      assert.deepEqual(env, { ADDED: "yes", PWD: "caller" });
    } finally { await shell.dispose(); }
  });
}

test("shell-local type mirrors the approved contract without casts", () => {
  const local: ShellInvokeOptions = { replaceEnv: true, env: {} };
  const contract: CommandInvokeOptions = local;
  const roundtrip: ShellInvokeOptions = contract;
  assert.equal(roundtrip.replaceEnv, true);
});

test("replacement does not impose a lineage policy on later default invocation", async () => {
  const { shell } = await setup();
  shell.register({ name: "default-child", execute: context => context.invoke!("report", [], { env: { ADDED: "yes" } }) });
  try {
    const result = await shell.exec("env -i KEEP=value default-child");
    assert.deepEqual(JSON.parse(result.stdout).env, { KEEP: "value", ADDED: "yes", PWD: "/work" });
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const env of [{ "bad=name": "value" }, { "bad\0name": "value" }, { GOOD: "bad\0value" }]) test(`validation before entry ${JSON.stringify(env)}`, async () => {
  const { shell } = await setup();
  let entered = false;
  shell.register({ name: "witness", execute() { entered = true; return { exitCode: 0 }; } });
  shell.register({ name: "forward", async execute(context) {
    await assert.rejects(context.invoke!("witness", [], { replaceEnv: true, env }), TypeError);
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("forward")).exitCode, 0); assert.equal(entered, false); }
  finally { await shell.dispose(); }
});

test("parent function locals, exports, cwd survive replacement and child status", async () => {
  const { shell, fs } = await setup();
  await fs.writeFile("/work/lib", Buffer.from("SECRET=sourced; export PUBLIC=changed; cd /other; false\n"));
  try {
    const result = await shell.exec("SECRET=outer; child() { . /work/lib; }; outer() { local SECRET=local; env -i child; printf '%s|%s|%s|%s\\n' \"$?\" \"$SECRET\" \"$PUBLIC\" \"$PWD\"; }; outer; printf '%s|%s|%s\\n' \"$SECRET\" \"$PUBLIC\" \"$PWD\"; report");
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines[0], "1|local|parent|/work"); assert.equal(lines[1], "outer|parent|/work");
    assert.deepEqual(JSON.parse(lines[2]!).env, { PUBLIC: "parent", A: "ancestor", PWD: "/work" });
    assert.equal(result.stderr, ""); assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("private clone remains private until explicit export; no global lineage reset", async () => {
  const { shell } = await setup();
  try {
    const result = await shell.exec("SECRET=private; child() { report; export SECRET; report; }; env -i child");
    const rows = result.stdout.trimEnd().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(rows.map(row => row.env), [{}, { SECRET: "private" }]);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("middleware sees exact child map; caller map is copied", async () => {
  const { shell } = await setup();
  const env = Object.freeze({ KEEP: "value" });
  const seen: string[] = [];
  shell.use(async (context, next) => {
    seen.push(context.command);
    if (context.command === "report") { assert.deepEqual({ ...context.env }, env); context.env.EXTRA = "middleware"; }
    return next();
  });
  shell.register({ name: "forward", execute: context => context.invoke!("report", [], { replaceEnv: true, env, cwd: "/other" }) });
  try {
    const result = await shell.exec("forward");
    assert.deepEqual(JSON.parse(result.stdout).env, { KEEP: "value", EXTRA: "middleware" });
    assert.deepEqual(env, { KEEP: "value" }); assert.deepEqual(seen, ["forward", "report"]);
  } finally { await shell.dispose(); }
});

for (const stdin of [undefined, "", Uint8Array.from([0, 255, 195, 169, 10])]) test(`origin and binary cursor ${String(stdin)}`, async () => {
  const { shell } = await setup();
  let origin: boolean | undefined;
  shell.register({ name: "stream", async execute(context) {
    assert.deepEqual({ ...context.env }, {}); origin = context.stdinIsDefault;
    await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("env -i stream | cat", stdin === undefined ? {} : { stdin });
    assert.deepEqual(result.stdoutBytes, typeof stdin === "object" ? stdin : new Uint8Array());
    assert.equal(origin, stdin === undefined);
  } finally { await shell.dispose(); }
});

test("read consumes only its prefix before nested replacement", async () => {
  const { shell } = await setup();
  try {
    const result = await shell.exec("read -r prefix; env -i cat", { stdin: Uint8Array.from([97, 10, 0, 255, 98]) });
    assert.deepEqual(result.stdoutBytes, Uint8Array.from([0, 255, 98]));
  } finally { await shell.dispose(); }
});
