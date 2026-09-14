import assert from "node:assert/strict";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { createOp, createObjectBackend, type OpBackend, type OpCommandContext } from "./index.js";

const binary = new Uint8Array([0, 255, 128, 13, 10, 195, 40]);
const reference = "op://Private/Service/data.bin";

function fixture(args: readonly string[], input = "") {
  const fs = createFsFromVolume(Volume.fromJSON({ "/work/keep": "existing" }));
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const writes: { path: string; bytes: Uint8Array; options: Parameters<NonNullable<OpCommandContext["writeFile"]>>[2] }[] = [];
  const controller = new AbortController();
  const context: OpCommandContext = {
    args, env: {}, signal: controller.signal,
    stdin: (async function* () { yield new TextEncoder().encode(input); })(),
    stdout: { async write(bytes) { output.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { errors.push(Uint8Array.from(bytes)); } },
    async writeFile(path, bytes, options) {
      writes.push({ path, bytes: Uint8Array.from(bytes), options });
      await fs.promises.writeFile(path, bytes, { mode: options?.mode, flag: options?.overwrite ? "w" : "wx" });
    }
  };
  const backend = createObjectBackend({
    vaults: [{ id: "vault", name: "Private" }],
    items: [{ id: "item", title: "Service", vault: "vault", category: "LOGIN", fields: [{ id: "text", value: "日本" }], files: [
      { id: "file", name: "data.bin", content: binary, size: binary.byteLength },
      { id: "empty", name: "empty.bin", content: new Uint8Array(), size: 0 }
    ] }]
  });
  return { fs, context, controller, backend, writes, output: () => Buffer.concat(output), errors: () => Buffer.concat(errors).toString() };
}

test("public read writes exact attachment content bytes without text encoding or a file newline", async () => {
  for (const suffix of ["", "?attribute=content", "?attr=content"]) {
    for (const encoding of [undefined, "SHIFT_JIS", "gbk"]) {
      const run = fixture(["read", reference + suffix, "--out-file", "/work/output", ...(encoding === undefined ? [] : ["--encoding", encoding])]);
      assert.deepEqual(await run.backend.execute({ resource: "secret", action: "read", args: [reference + suffix], flags: {} }, { signal: run.context.signal }), binary);
      assert.deepEqual(await createOp({ backend: run.backend }).execute(run.context), { exitCode: 0 }, run.errors());
      assert.deepEqual(Uint8Array.from(await run.fs.promises.readFile("/work/output") as Uint8Array), binary);
      assert.deepEqual(run.writes[0]?.options, { mode: 0o600, overwrite: false });
      assert.equal(run.output().byteLength, 0);
    }
  }
});

test("public read writes empty binary attachments as empty files", async () => {
  const run = fixture(["read", "op://Private/Service/empty.bin", "--out-file", "/work/empty"]);
  assert.deepEqual(await createOp({ backend: run.backend }).execute(run.context), { exitCode: 0 }, run.errors());
  assert.equal((await run.fs.promises.readFile("/work/empty") as Uint8Array).byteLength, 0);
});

test("public read sends binary stdout unchanged when no-newline is explicit", async () => {
  const run = fixture(["read", reference, "--no-newline", "--encoding", "gbk"]);
  assert.deepEqual(await createOp({ backend: run.backend }).execute(run.context), { exitCode: 0 }, run.errors());
  assert.deepEqual(Uint8Array.from(run.output()), binary);
});

test("public read renders numeric attachment size as decimal text with text newline options", async () => {
  for (const [name, size] of [["data.bin", binary.byteLength], ["empty.bin", 0]] as const) {
    for (const attribute of ["attribute", "attr"]) {
      for (const noNewline of [false, true]) {
        const selected = `op://Private/Service/${name}?${attribute}=size`;
        const run = fixture(["read", selected, ...(noNewline ? ["--no-newline"] : [])]);
        assert.equal(await run.backend.execute({ resource: "secret", action: "read", args: [selected], flags: {} }, { signal: run.context.signal }), size);
        assert.deepEqual(await createOp({ backend: run.backend }).execute(run.context), { exitCode: 0 }, run.errors());
        assert.equal(run.output().toString(), String(size) + (noNewline ? "" : "\n"));
      }
    }
  }
});

test("public read writes numeric size without a file newline and still encodes text values", async () => {
  const size = fixture(["read", reference + "?attribute=size", "--out-file", "/work/size", "--encoding", "SHIFT_JIS"]);
  assert.deepEqual(await createOp({ backend: size.backend }).execute(size.context), { exitCode: 0 }, size.errors());
  assert.equal(await size.fs.promises.readFile("/work/size", "utf8"), String(binary.byteLength));
  const text = fixture(["read", "op://Private/Service/text", "--out-file", "/work/text", "--encoding", "SHIFT_JIS"]);
  assert.deepEqual(await createOp({ backend: text.backend }).execute(text.context), { exitCode: 0 }, text.errors());
  assert.deepEqual(Uint8Array.from(await text.fs.promises.readFile("/work/text") as Uint8Array), new Uint8Array([0x93, 0xfa, 0x96, 0x7b]));
});

test("public read rejects arbitrary objects and invalid numeric metadata without coercion or disclosure", async () => {
  let coerced = false;
  const object = { password: "private-secret", toString() { coerced = true; return "private-secret"; } };
  for (const value of [object, [1, 2], true, null, undefined, new ArrayBuffer(2), NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const run = fixture(["read", reference + "?attribute=size", "--out-file", "/work/output"]);
    let calls = 0;
    const backend: OpBackend = { async execute() { calls++; return value; } };
    assert.equal((await createOp({ backend, authorize: () => "allow" }).execute(run.context)).exitCode, 1);
    assert.equal(calls, 1);
    assert.deepEqual(run.writes, []);
    assert.equal(run.output().byteLength, 0);
    assert.equal(run.errors().includes("private-secret"), false);
    assert.equal(run.fs.existsSync("/work/output"), false);
  }
  assert.equal(coerced, false);
});

test("inject and run explicitly reject binary and numeric backend values as non-text", async () => {
  for (const value of [binary, binary.byteLength]) {
    for (const command of ["inject", "run"]) {
      const run = fixture(command === "inject" ? ["inject"] : ["run", "--", "worker"], `{{ ${reference} }}`);
      let invoked = false;
      run.context.env = { TOKEN: reference };
      run.context.invoke = async () => { invoked = true; return { exitCode: 0 }; };
      let calls = 0;
      const backend: OpBackend = { async execute() { calls++; return value; } };
      assert.equal((await createOp({ backend, authorize: () => "allow" }).execute(run.context)).exitCode, 1);
      assert.equal(calls, 1);
      assert.equal(invoked, false);
      assert.equal(run.output().byteLength, 0);
      assert.ok(run.errors().includes("text"));
    }
  }
});

test("denied binary read blocks execution and files before or after permitted metadata resolution", async () => {
  for (const decision of ["deny", "ask"] as const) {
    const run = fixture(["read", reference, "--out-file", "/work/keep", "--force"]);
    let calls = 0;
    let approvals = 0;
    let resolutions = 0;
    let preparations = 0;
    const backend: OpBackend = {
      ...run.backend,
      async prepareBinding(requests, context) {
        preparations++;
        return run.backend.prepareBinding(requests, context);
      },
      async execute(request, context) { calls++; return run.backend.execute(request, context); },
    };
    const before = run.backend.snapshot();
    assert.equal((await createOp({ backend, authorize: () => decision,
      authorizeResolution: () => { resolutions++; return true; },
      approveResolved: manifest => {
        approvals++;
        assert.ok(manifest.targets.some(target => target.id === "item"));
        assert.deepEqual(manifest.output, { kind: "file", destination: "/work/keep" });
        return false;
      },
    }).execute(run.context)).exitCode, 1);
    assert.equal(approvals, decision === "ask" ? 1 : 0);
    assert.equal(resolutions, decision === "ask" ? 1 : 0);
    assert.equal(preparations, decision === "ask" ? 1 : 0);
    assert.equal(calls, 0);
    assert.deepEqual(run.backend.snapshot(), before);
    assert.deepEqual(run.writes, []);
    assert.equal(await run.fs.promises.readFile("/work/keep", "utf8"), "existing");
    assert.equal(run.output().byteLength, 0);
  }
});

test("binary read observes cancellation after resolution before writing", async () => {
  const run = fixture(["read", reference, "--out-file", "/work/output"]);
  let calls = 0;
  const backend: OpBackend = { async execute() { calls++; run.controller.abort(new Error("cancelled")); return binary; } };
  assert.equal((await createOp({ backend, authorize: () => "allow" }).execute(run.context)).exitCode, 130);
  assert.equal(calls, 1);
  assert.deepEqual(run.writes, []);
  assert.equal(run.output().byteLength, 0);
});

test("binary read awaits host output and propagates its failure without stdout fallback", async () => {
  const run = fixture(["read", reference, "--out-file", "/work/output"]);
  let rejectWrite!: (error: Error) => void;
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  run.context.writeFile = async (_path, bytes) => {
    assert.deepEqual(bytes, binary);
    entered();
    await new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  };
  let finished = false;
  const result = createOp({ backend: run.backend }).execute(run.context).then(result => { finished = true; return result; });
  await Promise.race([writing, result.then(() => { assert.fail("read completed before host output"); })]);
  assert.equal(finished, false);
  rejectWrite(new Error("write failed"));
  assert.equal((await result).exitCode, 1);
  assert.equal(run.output().byteLength, 0);
});
