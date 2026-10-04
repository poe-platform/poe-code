import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { createDiffCommand } from "./index.js";

for (const [flags, left, right] of [
  [["--strip-trailing-cr"], "binary\r\n\0", "binary\n\0"],
  [["-i"], "Same\nOLD\n", "same\nnew\n"],
  [["-b"], "first\na   b\nlast\n", "first\na b\nLAST\n"],
  [["-w"], "a b\nOLD\n", "ab\nNEW\n"],
  [["--ignore-trailing-space"], "same   \nOLD\n", "same\nNEW\n"],
  [["-E"], "a\tb\nOLD\n", "a       b\nNEW\n"],
  [["--strip-trailing-cr"], "same\r\nold\r\n", "same\nnew\n"],
  [["-w"], " \t", "\n"],
  [["-i"], "A", "a\n"],
  [["-i", "-E", "-b"], "É\tA   B\nOLD\n", "É       a b\nnew\n"],
] as const) test(`indexed normalization preserves bytes: ${flags} ${JSON.stringify(left)}`, async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new TextEncoder().encode(left));
  await fs.writeFile("/right", new TextEncoder().encode(right));
  const run = async (reference: boolean, format: string[]) => {
    let stdout = "", stderr = "";
    const result = await createDiffCommand().execute({
      command: "diff", args: [...flags, ...format, ...(reference ? ["-I", "^NEVER$"] : []), "/left", "/right"],
      cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    return { ...result, stdout, stderr };
  };
  for (const format of [[], ["-q"], ["-u"], ["-c"], ["-n"], ["-D", "FLAG"], ["-u", "-t", "-T", "--color=always"], ["-c", "--color=always"], ["-e"], ["-y", "-W", "21"], ["-y", "-t", "--color=always"], ["-y", "--left-column"], ["-y", "--suppress-common-lines"]]) {
    const expected = await run(true, format);
    const mock = t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole document loader"));
    try { assert.deepEqual(await run(false, format), expected, format.join(" ")); }
    finally { mock.mock.restore(); }
  }
});

for (const [flags, left, right] of [
  [["-i"], "A\nB\n", "a\nb\n"],
  [["-D", "FLAG"], "same\n", "same\n"],
] as const) test(`indexed comparison preserves line quotas for equivalent inputs: ${flags}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new TextEncoder().encode(left));
  await fs.writeFile("/right", new TextEncoder().encode(right));
  let stdout = "", stderr = "";
  const result = await createDiffCommand({ maxLines: 1 }).execute({
    command: "diff", args: [...flags, "/left", "/right"], cwd: "/", env: {}, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /line limit exceeded/u);
});

for (const flags of [["-aq"], ["-q", "-D", "FLAG"], ["-qy"]]) test(`brief line quotas match the buffered path: ${flags}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new TextEncoder().encode("same\n"));
  await fs.writeFile("/right", new TextEncoder().encode("same\n"));
  const run = async (reference: boolean) => {
    let stdout = "", stderr = "";
    const result = await createDiffCommand({ maxLines: 1 }).execute({
      command: "diff", args: [...flags, ...(reference ? ["-I", "^NEVER$"] : []), "/left", "/right"],
      cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    return { ...result, stdout, stderr };
  };
  assert.deepEqual(await run(false), await run(true));
});

for (const failure of ["none", "write", "cancel"] as const) test(`long trailing whitespace uses caller-backed normalization: ${failure}`, async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/right", new TextEncoder().encode("A\nnew\n"));
  const controller = new AbortController(), reason = new Error("normalization storage failed");
  let opened = 0, closed = 0, writes = 0, peak = 0, outstanding = 0, inputBytes = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => assert.fail("whole payload IO");
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const handle = await target.open!(...args), ordinal = ++opened;
      return new Proxy(handle, { get(descriptor, method) {
        if (method === "write") return async (...params: Parameters<typeof handle.write>) => {
          assert.ok(params[0].byteLength <= 16384);
          outstanding += params[0].byteLength; peak = Math.max(peak, outstanding); writes++;
          try {
            if (ordinal === 2 && failure === "write") throw reason;
            if (ordinal === 2 && failure === "cancel") controller.abort(reason);
            return await descriptor.write(...params);
          } finally { outstanding -= params[0].byteLength; }
        };
        if (method === "close") return async (...params: Parameters<typeof handle.close>) => { closed++; return descriptor.close(...params); };
        const value = Reflect.get(descriptor, method, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  t.mock.method(Budget.prototype, "read", async () => assert.fail("whole stdin loader"));
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole document loader"));
  let stdout = "", stderr = "";
  const execute = async () => createDiffCommand().execute({
    command: "diff", args: ["--ignore-trailing-space", "-", "/right"], cwd: "/", env: {}, fs: view,
    signal: controller.signal,
    inputBudget: { maxBytes: Infinity, check(total) { inputBytes = total; } },
    stdin: (async function* () {
      yield new Uint8Array([65]);
      const chunk = new Uint8Array(16384);
      for (let index = 0; index < 32; index++) { chunk.fill(32); yield chunk; }
      chunk.fill(0);
      yield new TextEncoder().encode("\nold\n");
    })(),
    stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); await new Promise(resolve => setImmediate(resolve)); stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  if (failure === "cancel") await assert.rejects(execute(), error => error === reason);
  else assert.equal((await execute()).exitCode, failure === "none" ? 1 : 2, stderr);
  assert.ok(opened >= 2, "both the original and normalized line must spill through caller storage");
  assert.equal(closed, opened); assert.equal(outstanding, 0); assert.equal(peak, 16384);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["right"]);
  if (failure !== "none") assert.equal(stdout, "");
  else {
    assert.equal(stdout, "2c2\n< old\n---\n> new\n");
    assert.equal(inputBytes, 1 + 32 * 16384 + 5 + 6);
    assert.ok(writes > 32);
  }
});

for (const invalid of [false, true]) test(`normalization respects split UTF-8 and paired byte fallback: invalid=${invalid}`, async t => {
  const fs = createMemoryFileSystem();
  const left = new Uint8Array([0xc3, 0xa9, 9, 65, 13, 10]);
  const right = invalid ? new Uint8Array([0xff, 9, 97, 10]) : new Uint8Array([0xc3, 0xa9, 32, 97, 10]);
  await fs.writeFile("/left", left); await fs.writeFile("/right", right);
  const run = async (reference: boolean) => {
    const output: Uint8Array[] = [];
    const result = await createDiffCommand().execute({
      command: "diff", args: ["-i", "-b", "-E", "--strip-trailing-cr", "-u", "-t", ...(reference ? ["-I", "^NEVER$"] : []), "-", "/right"],
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () { for (const byte of left) yield new Uint8Array([byte]); })(),
      stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
    });
    return { ...result, output: Buffer.concat(output) };
  };
  const expected = await run(true);
  t.mock.method(Budget.prototype, "read", async () => assert.fail("whole stdin loader"));
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole document loader"));
  assert.deepEqual(await run(false), expected);
});

for (const invalid of [false, true]) test(`normalization and display cross a UTF-8 page boundary: invalid=${invalid}`, async t => {
  const fs = createMemoryFileSystem();
  const prefix = "a".repeat(16383) + "😀";
  await fs.writeFile("/left", new TextEncoder().encode(prefix + "\tA\nold\n"));
  const body = new TextEncoder().encode(prefix + "        a\nnew\n");
  await fs.writeFile("/right", invalid ? new Uint8Array([...body, 255]) : body);
  const run = async (reference: boolean) => {
    const chunks: Uint8Array[] = [];
    const result = await createDiffCommand().execute({
      command: "diff", args: ["-i", "-E", "-u", "-t", ...(reference ? ["-I", "^NEVER$"] : []), "/left", "/right"],
      cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
    });
    return { ...result, output: Buffer.concat(chunks) };
  };
  const expected = await run(true);
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole document loader"));
  assert.deepEqual(await run(false), expected);
});
