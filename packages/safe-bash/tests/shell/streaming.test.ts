import assert from "node:assert/strict";
import { test } from "node:test";
import { writeText } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

test("pipes preserve bytes and launch downstream before upstream completes", { timeout: 3000 }, async () => {
  const { shell, commands } = setup({ limits: { pipeHighWaterMark: 1 } });
  let release!: () => void;
  const consumed = new Promise<void>((resolve) => { release = resolve; });
  commands.register({ name: "producer", async execute({ stdout }) {
    await stdout.write(Uint8Array.from([0, 255, 195]));
    await consumed;
    await stdout.write(Uint8Array.from([169, 128]));
    return { exitCode: 0 };
  } });
  commands.register({ name: "consumer", async execute({ stdin, stdout }) {
    for await (const chunk of stdin) { release(); await stdout.write(chunk); }
    return { exitCode: 0 };
  } });
  const result = await shell.exec("producer | consumer | pass");
  assert.equal(result.exitCode, 0);
  assert.deepEqual([...result.stdoutBytes], [0, 255, 195, 169, 128]);
});

test("early downstream exit and unused pipeline input do not deadlock", { timeout: 3000 }, async () => {
  const { shell, commands } = setup({ limits: { pipeHighWaterMark: 1 } });
  let writes = 0;
  commands.register({ name: "forever", async execute({ stdout }) {
    while (true) { await writeText(stdout, "chunk"); writes++; }
  } });
  commands.register({ name: "first", async execute({ stdin, stdout }) {
    for await (const chunk of stdin) { await stdout.write(chunk); break; }
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("forever | first")).stdout, "chunk");
  assert.equal((await shell.exec("forever | true")).exitCode, 0);
  assert.equal((await shell.exec("forever | missing-command")).exitCode, 127);
  assert.ok(writes < 10);
});

test("pipeline redirects replace endpoints without leaving blocked writers", { timeout: 3000 }, async () => {
  const { shell } = setup({ limits: { pipeHighWaterMark: 1 } });
  assert.equal((await shell.exec("say file > input; bytes | pass < input")).stdout, "file\n");
  assert.equal((await shell.exec("bytes > output | pass")).stdout, "");
});

test("streaming external sinks receive exact bytes and results retain captures", async () => {
  const { shell } = setup();
  const chunks: number[] = [];
  const result = await shell.exec("bytes | pass", { stdout: { async write(chunk) { chunks.push(...chunk); } } });
  assert.deepEqual(chunks, [0, 255, 195, 169, 128, 10]);
  assert.deepEqual([...result.stdoutBytes], chunks);
  assert.deepEqual([...(await shell.exec("pass", { stdin: Uint8Array.from([255, 0]) })).stdoutBytes], [255, 0]);
});

test("AbortSignal reaches commands and releases blocked pipelines", { timeout: 3000 }, async () => {
  const { shell, commands } = setup();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let observed: AbortSignal | undefined;
  commands.register({ name: "wait", async execute({ signal }) {
    observed = signal;
    ready();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  const controller = new AbortController();
  const task = shell.exec("bytes | wait", { signal: controller.signal });
  await started;
  const reason = new Error("cancelled by test");
  controller.abort(reason);
  await assert.rejects(task, (error) => error === reason);
  assert.equal(observed?.aborted, true);
  await assert.rejects(shell.exec("say never", { signal: controller.signal }), (error) => error === reason);
});

test("output, command, loop, source and expansion budgets reject deterministically", { timeout: 3000 }, async () => {
  const { shell } = setup();
  for (const [script, limits, expected] of [
    ["bytes | pass", { maxOutputBytes: 3 }, "maxOutputBytes"],
    ["true; true", { maxCommands: 1 }, "maxCommands"],
    ["while true; do true; done", { maxLoopIterations: 2 }, "maxLoopIterations"],
    ["say too long", { maxSourceBytes: 2 }, "maxSourceBytes"],
    ["args a b c", { maxExpansionFields: 2 }, "maxExpansionFields"],
    ['VALUE=abc; VALUE=$VALUE$VALUE$VALUE; args "$VALUE"', { maxExpansionBytes: 8 }, "maxExpansionBytes"],
    ['say "$(say "$(say nested)")"', { maxSubstitutionDepth: 1 }, "maxSubstitutionDepth"],
    ["recur() { recur; }; recur", { maxSubstitutionDepth: 2 }, "maxSubstitutionDepth"],
  ] as const) {
    await assert.rejects(shell.exec(script, { limits }), (error) => error instanceof ShellLimitError && error.limit === expected, script);
  }
});

test("middleware, asynchronous plugins and filesystem factories compose", async () => {
  const { shell, fs } = setup();
  const events: string[] = [];
  shell.use(async (context, next) => { events.push(`before:${context.command}`); const result = await next(); events.push(`after:${result.exitCode}`); return result; });
  shell.use({ name: "test", async setup(host) {
    await Promise.resolve();
    host.commands.register({ name: "plugin-command", async execute({ stdout }) { await writeText(stdout, "plugin"); return { exitCode: 4 }; } });
    host.registerFileSystem("test", () => fs);
  }, dispose() { events.push("dispose"); } });
  assert.equal((await shell.exec("plugin-command")).stdout, "plugin");
  assert.deepEqual(events, ["before:plugin-command", "after:4"]);
  assert.equal(await shell.createFileSystem("test"), fs);
  await shell.dispose();
  assert.equal(events.at(-1), "dispose");
  await assert.rejects(shell.exec("true"), /disposed/u);
});

test("parallel exec calls cannot leak environment, cwd or status", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => shell.exec('cd /other; VALUE=local; say "$VALUE"; pwd; status 7', { env: { VALUE: String(index) } })));
  assert.ok(results.every((result) => result.stdout === "local\n/other\n" && result.exitCode === 7));
  assert.equal((await shell.exec('args "$VALUE" "$?"; pwd')).stdout, '["","0"]/\n');
});
