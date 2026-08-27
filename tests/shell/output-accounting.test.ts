import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, writeText } from "../../src/index.js";
import type { CommandContext } from "../../src/contracts/index.js";

function setup() {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const calls: string[] = [];
  shell.use(async (context, next) => { calls.push(context.command); return next(); });
  shell.register({ name: "bridge", execute: context => context.invoke!("printf", ["1234"], { stdout: context.stdout, stderr: context.stderr }) });
  shell.register({ name: "outer", execute: context => context.invoke!("bridge", [], { stdout: context.stdout, stderr: context.stderr }) });
  return { shell, calls };
}
const limitError = (error: unknown) => error instanceof ShellLimitError && error.limit === "maxOutputBytes";

for (const [source, required] of [["printf 1234", 4], ["env -i printf 1234", 4], ["bridge", 4], ["outer", 4], ["env -i printf 1234 | cat", 8]] as const) {
  for (const allowed of [true, false]) test(`actual command ${source} limit ${required - (allowed ? 0 : 1)}`, async () => {
    const { shell, calls } = setup(); let visible = "";
    const operation = shell.exec(source, { limits: { maxOutputBytes: required - (allowed ? 0 : 1) }, stdout: { async write(bytes) { visible += Buffer.from(bytes).toString(); } } });
    try {
      if (allowed) { const result = await operation; assert.equal(result.exitCode, 0); assert.equal(result.stdout, "1234"); assert.equal(result.stderr, ""); assert.equal(visible, "1234"); }
      else { await assert.rejects(operation, limitError); assert.equal(visible, ""); }
      assert.ok(calls.includes("printf"));
    } finally { await shell.dispose(); }
  });
}

for (const replaceEnv of [undefined, false, true]) for (const explicit of [false, true]) test(`nested forwarding flag=${replaceEnv} explicit=${explicit}`, async () => {
  const { shell } = setup();
  const options = (context: CommandContext) => ({ ...(replaceEnv === undefined ? {} : { replaceEnv }), ...(explicit ? { stdout: context.stdout, stderr: context.stderr } : {}) });
  shell.register({ name: "first", execute: context => context.invoke!("second", [], options(context)) });
  shell.register({ name: "second", execute: context => context.invoke!("printf", ["1234"], options(context)) });
  try { const result = await shell.exec("first", { limits: { maxOutputBytes: 4 } }); assert.equal(result.stdout, "1234"); assert.equal(result.exitCode, 0); }
  finally { await shell.dispose(); }
});

for (const channels of [["stdout", "stdout"], ["stderr", "stderr"], ["stdout", "stderr"]] as const) test(`same buffer remains distinct writes ${channels}`, async () => {
  const { shell } = setup(); let delivered = ""; let calls = 0;
  const bytes = Buffer.from("1234");
  shell.register({ name: "twice", async execute(context) { calls++; await context[channels[0]].write(bytes); await context[channels[1]].write(bytes); return { exitCode: 0 }; } });
  const sink = { async write(chunk: Uint8Array) { delivered += Buffer.from(chunk).toString(); } };
  try { await assert.rejects(shell.exec("env -i twice", { limits: { maxOutputBytes: 4 }, stdout: sink, stderr: sink }), limitError); assert.equal(delivered, "1234"); assert.equal(calls, 1); }
  finally { await shell.dispose(); }
});

for (const route of ["stdout-to-stderr", "stderr-to-stdout", "both-to-stdout"] as const) test(`known contextual alias ${route}`, async () => {
  const { shell } = setup();
  shell.register({ name: "channels", async execute(context) {
    await writeText(route === "stdout-to-stderr" ? context.stdout : context.stderr, "1234"); return { exitCode: 0 };
  } });
  shell.register({ name: "alias", execute: context => context.invoke!("channels", [], route === "stdout-to-stderr" ? { stdout: context.stderr } : route === "stderr-to-stdout" ? { stderr: context.stdout } : { stdout: context.stdout, stderr: context.stdout }) });
  try { const result = await shell.exec("alias", { limits: { maxOutputBytes: 4 } }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, route === "stdout-to-stderr" ? "" : "1234"); assert.equal(result.stderr, route === "stdout-to-stderr" ? "1234" : ""); }
  finally { await shell.dispose(); }
});

for (const maximum of [3, 4]) test(`new external sink limit ${maximum}`, async () => {
  const { shell } = setup(); let delivered = "";
  shell.register({ name: "external", execute: context => context.invoke!("printf", ["1234"], { stdout: { async write(bytes) { delivered += Buffer.from(bytes).toString(); } } }) });
  try {
    const operation = shell.exec("external", { limits: { maxOutputBytes: maximum } });
    if (maximum === 3) await assert.rejects(operation, limitError); else assert.equal((await operation).stdout, "");
    assert.equal(delivered, maximum === 3 ? "" : "1234");
  } finally { await shell.dispose(); }
});

test("middleware replacement of contextual sink cannot bypass accounting", async () => {
  const { shell } = setup(); let delivered = "";
  shell.use(async (context, next) => {
    if (context.command === "bridge") Object.defineProperty(context, "stdout", { value: { async write(bytes: Uint8Array) { delivered += Buffer.from(bytes).toString(); } } });
    return next();
  });
  try { await assert.rejects(shell.exec("bridge", { limits: { maxOutputBytes: 3 } }), limitError); assert.equal(delivered, ""); }
  finally { await shell.dispose(); }
});

test("unknown host proxy is not blindly unwrapped", async () => {
  const { shell } = setup(); let visible = "";
  shell.register({ name: "proxy", execute: context => context.invoke!("printf", ["1234"], { stdout: new Proxy(context.stdout, {}) }) });
  try { await assert.rejects(shell.exec("proxy", { limits: { maxOutputBytes: 4 }, stdout: { async write(bytes) { visible += Buffer.from(bytes).toString(); } } }), limitError); assert.equal(visible, ""); }
  finally { await shell.dispose(); }
});

test("mutating an owned sink write cannot retain its accounting exemption", async () => {
  const { shell } = setup(); let delivered = "";
  shell.register({ name: "changed", execute(context) {
    Object.defineProperty(context.stdout, "write", { value: async (bytes: Uint8Array) => { delivered += Buffer.from(bytes).toString(); } });
    return context.invoke!("printf", ["1234"], { stdout: context.stdout });
  } });
  try { await assert.rejects(shell.exec("changed", { limits: { maxOutputBytes: 3 } }), limitError); assert.equal(delivered, ""); }
  finally { await shell.dispose(); }
});

test("concurrent same-buffer writes reserve budget before effects", async () => {
  const { shell } = setup(); let delivered = ""; let statuses: string[] = [];
  shell.register({ name: "parallel", async execute(context) {
    const bytes = Buffer.from("1234");
    const results = await Promise.allSettled([context.stdout.write(bytes), context.stdout.write(bytes)]);
    statuses = results.map(result => result.status);
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("env -i parallel", { limits: { maxOutputBytes: 4 }, stdout: { async write(bytes) { delivered += Buffer.from(bytes).toString(); } } }), limitError);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delivered, "1234"); assert.equal(statuses.length, 2); assert.equal(statuses[1], "rejected");
  } finally { await shell.dispose(); }
});
