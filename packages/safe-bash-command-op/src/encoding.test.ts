import assert from "node:assert/strict";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { createOp, createObjectBackend, createOpTextCodec, renderOpOutput, type OpCommandContext } from "./index.js";

const japanese = new Uint8Array([0x93, 0xfa, 0x96, 0x7b]);
const chinese = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);

function fixture(args: string[], input = new Uint8Array()) {
  const fs = createFsFromVolume(new Volume());
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context: OpCommandContext = {
    args, env: {}, signal: new AbortController().signal,
    stdin: (async function* () { for (const byte of input) yield new Uint8Array([byte]); })(),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
    async readFile(path) { return fs.promises.readFile(path) as Promise<Buffer>; },
    async writeFile(path, bytes) { await fs.promises.writeFile(path, bytes); },
  };
  return { fs, context, output, errors };
}

test("portable codecs encode known Shift_JIS and GBK bytes and decode split multibyte input", () => {
  for (const [encoding, text, bytes] of [["SHIFT_JIS", "日本", japanese], ["gbk", "中文", chinese]] as const) {
    const codec = createOpTextCodec(encoding);
    assert.deepEqual(codec.encode(text), bytes);
    const decoder = codec.decoder();
    let decoded = "";
    for (const byte of bytes) decoded += decoder.decode(new Uint8Array([byte]), { stream: true });
    decoded += decoder.decode();
    assert.equal(decoded, text);
  }
  assert.deepEqual(createOpTextCodec(undefined).encode("日本"), new TextEncoder().encode("日本"));
});

test("codec accepts only native verified aliases, including empty default", () => {
  for (const label of ["SHIFT_JIS", "shift-jis", "shiftjis", "sjis", "sJiS"]) {
    assert.deepEqual(createOpTextCodec(label).encode("日本"), japanese);
  }
  assert.deepEqual(createOpTextCodec("GBK").encode("中文"), chinese);
  assert.deepEqual(createOpTextCodec("").encode("日本"), new TextEncoder().encode("日本"));
  for (const label of ["UTF-8", "utf8", "gb2312", "cp932", " gbk", "gbk ", "not-an-encoding"]) {
    assert.throws(() => createOpTextCodec(label));
  }
});

test("global encoding transcodes generic JSON stdin and metadata output", async () => {
  for (const [encoding, text, bytes] of [["SHIFT_JIS", "日本", japanese], ["gbk", "中文", chinese]] as const) {
    const prefix = new TextEncoder().encode('{"name":"');
    const suffix = new TextEncoder().encode('"}');
    const run = fixture(["group", "create", "--encoding", encoding, "--format=json"], new Uint8Array([...prefix, ...bytes, ...suffix]));
    const op = createOp({ backend: { async execute(request) { assert.deepEqual(request.input, { name: text }); return { name: text }; } } });
    assert.equal((await op.execute(run.context)).exitCode, 0);
    assert.deepEqual(JSON.parse(new TextDecoder(encoding).decode(Buffer.concat(run.output))), { name: text });
    assert.ok(Buffer.concat(run.output).includes(Buffer.from(bytes)));
  }
});

test("item templates decode selected encoding from files and produce selected metadata bytes", async () => {
  const run = fixture(["item", "create", "--template=/item.json", "--encoding=gbk", "--format=json"]);
  run.fs.writeFileSync("/item.json", Buffer.from([...new TextEncoder().encode('{"title":"'), ...chinese, ...new TextEncoder().encode('"}')]));
  const op = createOp({ backend: { async execute(request) { assert.deepEqual(request.input, { title: "中文" }); return { id: "item", title: "中文" }; } } });
  assert.equal((await op.execute(run.context)).exitCode, 0);
  assert.ok(Buffer.concat(run.output).includes(Buffer.from(chinese)));
});

test("read and inject transcode their text output and inject decodes selected template encoding", async () => {
  const backend = { async execute() { return "日本"; } };
  const op = createOp({ backend });
  const read = fixture(["read", "op://vault/item/field", "--encoding=SHIFT_JIS", "--no-newline"]);
  assert.equal((await op.execute(read.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(read.output), Buffer.from(japanese));
  const inject = fixture(["inject", "--encoding=SHIFT_JIS", "-o", "/output"], new Uint8Array([...japanese, ...new TextEncoder().encode(" {{ op://vault/item/field }}")]));
  assert.equal((await op.execute(inject.context)).exitCode, 0);
  assert.deepEqual(inject.fs.readFileSync("/output"), Buffer.from([...japanese, 32, ...japanese]));
});

test("document upload and download ignore text transcoding", async () => {
  const bytes = new Uint8Array([255, 0, 128, ...japanese]);
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  const op = createOp({ backend });
  const run = fixture(["document", "create", "-", "--encoding=gbk", "--format=json"], bytes);
  assert.equal((await op.execute(run.context)).exitCode, 0);
  const result = JSON.parse(Buffer.concat(run.output).toString()) as { id: string };
  run.context.args = ["document", "get", result.id, "--encoding=gbk"];
  run.output.length = 0;
  assert.equal((await op.execute(run.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from(bytes));
});

test("dotenv stays UTF8 and child output bytes are not transcoded", async () => {
  const run = fixture(["run", "--encoding=SHIFT_JIS", "--env-file=/env", "--no-masking", "--", "worker"]);
  run.fs.writeFileSync("/env", "NAME=中文\n");
  const bytes = new Uint8Array([255, 0, 128, ...chinese]);
  run.context.invoke = async (_command, _args, options) => {
    assert.equal(options.env.NAME, "中文");
    await options.stdout!.write(bytes);
    return { exitCode: 0 };
  };
  const op = createOp({ backend: { async execute() { throw new Error("unexpected backend"); } } });
  assert.equal((await op.execute(run.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from(bytes));
});

test("unsupported encoding fails before backend effects", async () => {
  let calls = 0;
  const run = fixture(["item", "list", "--encoding=not-an-encoding"]);
  const op = createOp({ backend: { async execute() { calls++; return []; } } });
  assert.equal((await op.execute(run.context)).exitCode, 1);
  assert.equal(calls, 0);
});

test("native help and version flags bypass encoding validation, but help command does not", async () => {
  const op = createOp({ backend: { async execute() { throw new Error("unexpected backend"); } } });
  for (const flag of ["--help", "--version"]) {
    const run = fixture(["--encoding=UTF-8", flag]);
    assert.equal((await op.execute(run.context)).exitCode, 0);
  }
  const help = fixture(["--encoding=UTF-8", "help"]);
  assert.equal((await op.execute(help.context)).exitCode, 1);
  assert.ok(Buffer.concat(help.errors).toString().includes("unsupported character-encoding"));
  const valid = fixture(["--encoding=gbk", "help"]);
  assert.equal((await op.execute(valid.context)).exitCode, 0);
});

test("selected encoding decodes UTF8 argv before approval and keeps diagnostics UTF8", async () => {
  const run = fixture(["item", "get", "日本", "--vault=日本", "--encoding=shift_jis"]);
  const expected = "譌･譛ｬ";
  const op = createOp({
    authorize(request) {
      assert.deepEqual(request.args, [expected]);
      assert.equal(request.flags.vault, expected);
      return "allow";
    },
    backend: { async execute() { throw new Error("日本"); } },
  });
  assert.equal((await op.execute(run.context)).exitCode, 1);
  assert.equal(Buffer.concat(run.errors).toString(), "op: 日本\n");
});

test("public renderer encodes human fields while concealing passwords", () => {
  const output = renderOpOutput({ fields: [{ id: "username", value: "中文" }, { id: "password", type: "CONCEALED", value: "private" }] }, {
    resource: "item", action: "get", args: [], flags: { encoding: "GBK", fields: ["username", "password"] },
  });
  assert.ok(output);
  assert.ok(Buffer.from(output).includes(Buffer.from(chinese)));
  assert.equal(Buffer.from(output).includes(Buffer.from("private")), false);
});

test("generic text out-file uses selected encoding and preserves file write policy", async () => {
  const run = fixture(["item", "template", "get", "Login", "--encoding=gbk", "--out-file=/output", "--force", "--file-mode=0640"]);
  const write = run.context.writeFile!;
  run.context.writeFile = async (path, bytes, options) => {
    assert.deepEqual(options, { mode: 0o640, overwrite: true });
    await write(path, bytes, options);
  };
  const op = createOp({ backend: { async execute() { return "中文"; } } });
  assert.equal((await op.execute(run.context)).exitCode, 0);
  assert.deepEqual(run.fs.readFileSync("/output"), Buffer.from([...chinese, 10]));
  assert.equal(run.output.length, 0);
});
