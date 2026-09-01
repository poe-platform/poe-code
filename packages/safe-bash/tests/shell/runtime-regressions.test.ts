import assert from "node:assert/strict";
import { test } from "node:test";
import { writeText } from "../../src/contracts/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

test("synchronous cancellation observes already-rejected command promises", async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = new Error("cancelled");
  shell.use(() => { controller.abort(reason); throw new Error("late command rejection"); });
  await assert.rejects(shell.exec("true", { signal: controller.signal }), (error) => error === reason);
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("synchronous cancellation observes already-rejected input promises", async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const stdin: ByteSource = {
    [Symbol.asyncIterator]() {
      return { next() { controller.abort(reason); return Promise.reject(new Error("late input rejection")); } };
    },
  };
  await assert.rejects(shell.exec("pass", { signal: controller.signal, stdin }), (error) => error === reason);
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("blocked upstream reads require caller cancellation, not consumer completion", { timeout: 2000 }, async () => {
  for (const script of ["pass | true", "pass | pass < input", "pass | pass | true"]) {
    const { shell, fs } = setup();
    await fs.writeFile("/input", new TextEncoder().encode("file\n"));
    let returned = 0;
    const stdin: ByteSource = {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise(() => {}), async return() { returned++; return { done: true, value: undefined }; } };
      },
    };
    const controller = new AbortController();
    const reason = new Error("cancel blocked producer");
    const timeout = setTimeout(() => controller.abort(reason), 30);
    try { await assert.rejects(shell.exec(script, { stdin, signal: controller.signal }), (error) => error === reason); }
    finally { clearTimeout(timeout); }
    assert.equal(returned, 1, script);
  }
});

test("broken-pipe writes cancel signal-waiting upstream commands", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let aborted = false;
  commands.register({ name: "waiting", async execute({ signal, stdout }) {
    try { while (true) await writeText(stdout, "chunk"); }
    catch { aborted = signal.aborted; }
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    aborted = signal.aborted;
    signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("waiting | true")).exitCode, 0);
  assert.equal(aborted, true);
  assert.equal((await shell.exec("set -o pipefail; waiting | true")).exitCode, 141);
});

test("redirected input resources close after partial, zero and failed consumption", async () => {
  for (const script of ["first < input", "true < input", "true < input < missing", "true < input 0<&-"]) {
    const { shell, fs, commands } = setup();
    await fs.writeFile("/input", new Uint8Array([1, 2, 3]));
    let returned = 0;
    fs.readStream = () => ({ [Symbol.asyncIterator]() {
      return { async next() { return { value: new Uint8Array([1]), done: false }; }, async return() { returned++; return { value: undefined, done: true }; } };
    } });
    commands.register({ name: "first", async execute({ stdin }) { for await (const ignoredChunk of stdin) break; return { exitCode: 0 }; } });
    await shell.exec(script);
    assert.equal(returned, 1, script);
  }
});

test("independent truncate descriptors maintain offsets, duplicated descriptors share them", async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "mixed", async execute({ stdout, stderr }) {
    await writeText(stdout, "abcdef");
    await writeText(stderr, "XY");
    await writeText(stdout, "!");
    await writeText(stderr, "Z");
    return { exitCode: 0 };
  } });
  const read = async () => new TextDecoder().decode(await fs.readFile("/same"));
  await shell.exec("both >same 2>same");
  assert.equal(await read(), "err\n");
  await shell.exec("mixed >same 2>same");
  assert.equal(await read(), "XYZdef!");
  await shell.exec("mixed >same 2>&1");
  assert.equal(await read(), "abcdefXY!Z");
  await shell.exec("both >same 2>>same");
  assert.equal(await read(), "out\nerr\n");
});

test("redirection failure diagnostics honor descriptors already established", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/keep", new TextEncoder().encode("keep"));
  const result = await shell.exec('DIAGNOSTIC=$(pass 2>&1 <missing >keep); args "$?" "$DIAGNOSTIC"');
  const values = JSON.parse(result.stdout) as string[];
  assert.equal(values[0], "1");
  assert.match(values[1]!, /missing/u);
  assert.equal(result.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/keep")), "keep");
  assert.equal((await shell.exec("status 999 2>errors")).stderr, "");
  assert.match(new TextDecoder().decode(await fs.readFile("/errors")), /Exit status/u);
});

test("declarations preserve expanded whitespace and functions export prefix values", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('VALUE="hello world"; export RESULT=$VALUE; args "$RESULT"; envget world')).stdout, '["hello world"]<unset>');
  assert.equal((await shell.exec('f() { envget VALUE; }; VALUE=temp f; envget VALUE')).stdout, "temp<unset>");
  assert.equal((await shell.exec('VALUE=outer; f() { local VALUE=inner; VALUE=changed; }; f; args "$VALUE"')).stdout, '["outer"]');
  assert.equal((await shell.exec('VALUE=outer; f() { local VALUE="two words"; g; args "$VALUE"; }; g() { local VALUE=other; }; f; args "$VALUE"')).stdout, '["two words"]["outer"]');
});

test("builtins honor middleware cwd and environment overlays", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  shell.use(async (context, next) => {
    context.cwd = "/other";
    context.env.HOME = "/other";
    return next();
  });
  assert.equal((await shell.exec("pwd")).stdout, "/other\n");
  const changed = await shell.exec("cd; pwd");
  assert.equal(changed.stdout, "/other\n");
  assert.equal(changed.stderr, "");
});

test("read and repeated commands share one non-replayable stdin offset", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('IFS= read -r FIRST; say "$FIRST"; pass; pass', { stdin: "first\nsecond\n" })).stdout, "first\nsecond\n");
  assert.equal((await shell.exec('while IFS= read -r line; do args "$line"; done', { stdin: "a\nb c\n" })).stdout, '["a"]["b c"]');
  assert.equal((await shell.exec('read -r line; args "$line" "$?"', { stdin: "no newline" })).stdout, '["no newline","1"]');
  const replayable: ByteSource = { async *[Symbol.asyncIterator]() { yield new Uint8Array([65]); } };
  assert.equal((await shell.exec("pass; pass", { stdin: replayable })).stdout, "A");
});

test("syntax validation does not even initialize inherited input", async () => {
  const { shell } = setup();
  let opened = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { opened++; return { async next() { return { value: undefined, done: true }; } }; } };
  assert.equal((await shell.exec("true &&", { stdin })).exitCode, 2);
  assert.equal(opened, 0);
});

test("arithmetic stays bounded and handles short circuit, updates and overflow", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('COUNT=3; args "$((COUNT * 2 + 1))" "$((COUNT += 2))" "$COUNT"')).stdout, '["7","5","5"]');
  assert.equal((await shell.exec('COUNT=0; until (( COUNT == 3 )); do say "$COUNT"; ((COUNT++)); done')).stdout, "0\n1\n2\n");
  assert.equal((await shell.exec('args "$((0 && (COUNT=7)))" "$((1 || (COUNT=9)))" "$COUNT" "$((9223372036854775807 + 1))"')).stdout, '["0","1","","-9223372036854775808"]');
  assert.equal((await shell.exec('args "$((1 / 0))"')).exitCode, 1);
});
