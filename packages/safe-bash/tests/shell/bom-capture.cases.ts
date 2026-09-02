import assert from "node:assert/strict";
import { test } from "node:test";
import { pipeBytes } from "../../src/contracts/index.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

const channels = ["stdout", "stderr"] as const;
const bounded = { timeout: 2_000 };
const fixtures = [
  { name: "empty", chunks: [""], hex: "", text: "", defaultText: "" },
  { name: "BOM alone", chunks: ["efbbbf"], hex: "efbbbf", text: "\uFEFF", defaultText: "" },
  { name: "BOM plus ASCII", chunks: ["efbbbf41"], hex: "efbbbf41", text: "\uFEFFA", defaultText: "A" },
  { name: "BOM plus UTF8", chunks: ["efbbbfc3a9f09f9880"], hex: "efbbbfc3a9f09f9880", text: "\uFEFFé😀", defaultText: "é😀" },
  { name: "interior BOM", chunks: ["41efbbbf42"], hex: "41efbbbf42", text: "A\uFEFFB", defaultText: "A\uFEFFB" },
  { name: "split BOM and UTF8", chunks: ["", "ef", "", "bb", "bf", "c3", "a9", "f09f", "9880"], hex: "efbbbfc3a9f09f9880", text: "\uFEFFé😀", defaultText: "é😀" },
  { name: "repeated BOM chunks", chunks: ["efbbbf", "efbbbf", "41", "efbbbf"], hex: "efbbbfefbbbf41efbbbf", text: "\uFEFF\uFEFFA\uFEFF", defaultText: "\uFEFFA\uFEFF" },
  { name: "invalid UTF8 replacement", chunks: ["c3", "28ff"], hex: "c328ff", text: "\uFFFD(\uFFFD", defaultText: "\uFFFD(\uFFFD" },
  { name: "BOM then invalid UTF8", chunks: ["efbbbf", "c328ff"], hex: "efbbbfc328ff", text: "\uFEFF\uFFFD(\uFFFD", defaultText: "\uFFFD(\uFFFD" },
  { name: "literal non-BOM binary", chunks: ["00ff", "fe8041"], hex: "00fffe8041", text: "\0\uFFFD\uFFFD\uFFFDA", defaultText: "\0\uFFFD\uFFFD\uFFFDA" },
  { name: "incomplete BOM prefix", chunks: ["ef", "bb"], hex: "efbb", text: "\uFFFD", defaultText: "\uFFFD" },
] as const;

async function capture(channel: typeof channels[number], chunks: readonly string[]) {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const external: Buffer[] = [];
  shell.register({
    name: "emit-bom-fixture",
    async execute(context) {
      for (const chunk of chunks) await context[channel].write(Buffer.from(chunk, "hex"));
      return { exitCode: 0 };
    },
  });
  try {
    const result = await shell.exec("emit-bom-fixture", {
      [channel]: { async write(chunk: Uint8Array) { external.push(Buffer.from(chunk)); } },
    });
    return { result, externalHex: Buffer.concat(external).toString("hex") };
  } finally {
    await shell.dispose();
  }
}

for (const fixture of fixtures) {
  test(`decoder baseline: ${fixture.name}`, bounded, () => {
    const bytes = Buffer.concat(fixture.chunks.map((chunk) => Buffer.from(chunk, "hex")));
    assert.equal(bytes.toString("hex"), fixture.hex);
    assert.equal(new TextDecoder().decode(bytes), fixture.defaultText);
    assert.equal(new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes), fixture.defaultText);
    assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), fixture.text);
    for (const ignoreBOM of [false, true]) {
      const decoder = new TextDecoder("utf-8", { ignoreBOM });
      const decoded = fixture.chunks.map((chunk) => decoder.decode(Buffer.from(chunk, "hex"), { stream: true })).join("") + decoder.decode();
      assert.equal(decoded, ignoreBOM ? fixture.text : fixture.defaultText);
    }
  });
  for (const channel of channels) {
    test(`${channel} byte fields and external sink: ${fixture.name}`, bounded, async () => {
      const { result, externalHex } = await capture(channel, fixture.chunks);
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.from(result[`${channel}Bytes`]).toString("hex"), fixture.hex);
      assert.equal(externalHex, fixture.hex);
      const other = channel === "stdout" ? "stderr" : "stdout";
      assert.equal(result[other], "");
      assert.equal(result[`${other}Bytes`].length, 0);
    });
    test(`${channel} preserves decoded text: ${fixture.name}`, bounded, async () => {
      const { result } = await capture(channel, fixture.chunks);
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.from(result[`${channel}Bytes`]).toString("hex"), fixture.hex);
      assert.equal(result[channel], fixture.text, `${channel} bytes=${fixture.hex}`);
    });
  }
}

for (const channel of channels) {
  test(`${channel} repeated execs preserve independent BOMs`, bounded, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.register({ name: "emit", async execute(context) { await context[channel].write(Buffer.from("efbbbf41", "hex")); return { exitCode: 0 }; } });
    try {
      const results = [];
      for (let execution = 0; execution < 3; execution++) results.push(await shell.exec("emit"));
      assert.deepEqual(results.map((result) => Buffer.from(result[`${channel}Bytes`]).toString("hex")), ["efbbbf41", "efbbbf41", "efbbbf41"]);
      assert.deepEqual(results.map((result) => result[channel]), ["\uFEFFA", "\uFEFFA", "\uFEFFA"]);
    } finally { await shell.dispose(); }
  });
  test(`${channel} string and byte stdin retain the same decoded BOM`, bounded, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.register({ name: "forward", async execute(context) { await pipeBytes(context.stdin, context[channel], context.signal); return { exitCode: 0 }; } });
    try {
      const stringResult = await shell.exec("forward", { stdin: "\uFEFFé" });
      const byteResult = await shell.exec("forward", { stdin: Buffer.from("efbbbfc3a9", "hex") });
      for (const result of [stringResult, byteResult]) {
        assert.equal(result.exitCode, 0);
        assert.equal(Buffer.from(result[`${channel}Bytes`]).toString("hex"), "efbbbfc3a9");
      }
      assert.deepEqual([stringResult[channel], byteResult[channel]], ["\uFEFFé", "\uFEFFé"]);
    } finally { await shell.dispose(); }
  });
}

for (const maxOutputBytes of [5, 6]) {
  test(`combined output cap counts all six BOM bytes: cap=${maxOutputBytes}`, bounded, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    shell.register({ name: "both", async execute(context) {
      for (const channel of channels) await context[channel].write(Buffer.from("efbbbf", "hex"));
      return { exitCode: 0 };
    } });
    try {
      if (maxOutputBytes === 5) {
        await assert.rejects(shell.exec("both", { limits: { maxOutputBytes } }), (error: unknown) => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      } else {
        const result = await shell.exec("both", { limits: { maxOutputBytes } });
        assert.equal(result.exitCode, 0);
        for (const channel of channels) assert.equal(Buffer.from(result[`${channel}Bytes`]).toString("hex"), "efbbbf");
      }
    } finally { await shell.dispose(); }
  });
}

test("pre-aborted capture does not enter the command or external sinks", bounded, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  let calls = 0;
  shell.register({ name: "emit", execute() { calls++; return { exitCode: 0 }; } });
  const reason = new Error("bounded BOM capture cancellation control");
  try {
    await assert.rejects(shell.exec("emit", {
      signal: AbortSignal.abort(reason),
      stdout: { async write() { calls++; } }, stderr: { async write() { calls++; } },
    }), (error: unknown) => error === reason);
    assert.equal(calls, 0);
  } finally { await shell.dispose(); }
});

test("JSON.parse control distinguishes parser input from decoder BOM policy", bounded, () => {
  const bytes = Buffer.from("efbbbf7b226f6b223a317d", "hex");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), { ok: 1 });
  assert.throws(() => JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)), SyntaxError);
});

test("existing jq plugin retains its own JSON input decoding", bounded, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(structuredCommands());
  try {
    for (const stdin of ['{"ok":1}', "\uFEFF{\"ok\":1}", Buffer.from("efbbbf7b226f6b223a317d", "hex")]) {
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      const result = await shell.exec("jq -c .", {
        stdin,
        stdout: { async write(chunk) { stdoutChunks.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { stderrChunks.push(new Uint8Array(chunk)); } },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, '{"ok":1}\n');
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "7b226f6b223a317d0a");
      assert.equal(result.stderr, "");
      assert.equal(result.stderrBytes.length, 0);
      assert.equal(new TextDecoder().decode(result.stderrBytes), result.stderr);
      assert.equal(Buffer.concat(stdoutChunks).toString("hex"), Buffer.from(result.stdoutBytes).toString("hex"));
      assert.equal(Buffer.concat(stderrChunks).toString("hex"), Buffer.from(result.stderrBytes).toString("hex"));
    }
  } finally { await shell.dispose(); }
});
