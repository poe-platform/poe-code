import assert from "node:assert/strict";
import { test } from "node:test";
import { Volume, createFsFromVolume } from "memfs";
import { createOpCommand, type OpCommandContext, type OpFileWriteOptions } from "./cli.js";
import { createDocumentHandlers } from "./documents.js";
import type { OpBackend, OpBackendRequest } from "./types.js";
import { createObjectBackend } from "./backend.js";
import { createOp } from "./index.js";

function fixture(args: string[], result: unknown = { id: "document-id", content: new Uint8Array([255, 0, 128]) }, maxBytes?: number) {
  const fs = createFsFromVolume(new Volume());
  const output: Uint8Array[] = [];
  const requests: OpBackendRequest[] = [];
  const writes: OpFileWriteOptions[] = [];
  const backend: OpBackend = { async execute(request) { requests.push(request); return result; } };
  const context: OpCommandContext = {
    args, env: {}, signal: new AbortController().signal,
    stdin: (async function* () { yield new Uint8Array([255, 0, 128]); })(),
    stdout: { async write(data) { output.push(data.slice()); } }, stderr: { async write() {} },
    async readFile(path) { return fs.promises.readFile(path) as Promise<Buffer>; },
    async writeFile(path, bytes, options) {
      assert.ok(options);
      writes.push(options);
      await fs.promises.writeFile(path, bytes, { mode: options.mode, flag: options.overwrite ? "w" : "wx" });
    },
  };
  const command = createOpCommand({ backend, handlers: createDocumentHandlers(backend, { maxBytes }) });
  return { fs, output, requests, writes, context, command };
}

test("document create preserves binary stdin and creates metadata with explicit names", async () => {
  const run = fixture(["document", "create", "-", "--file-name=bytes.bin", "--title=Backup", "--vault=Work", "--tags=a,b", "--format=json"]);
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  const request = run.requests[0]!;
  assert.deepEqual(request.args, []);
  assert.deepEqual(request.input, { content: new Uint8Array([255, 0, 128]), name: "bytes.bin", title: "Backup", vault: "Work", tags: ["a", "b"] });
  assert.deepEqual(JSON.parse(Buffer.concat(run.output).toString()), { id: "document-id" });
});

test("file uploads derive filename and title, leave vault selection to backend and never consume stdin", async () => {
  const run = fixture(["document", "create", "/archive.dat"]);
  run.fs.writeFileSync("/archive.dat", Buffer.from([0, 255, 10]));
  run.context.stdin = { [Symbol.asyncIterator]() { throw new Error("unexpected stdin"); } };
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.deepEqual(run.requests[0]!.input, { content: new Uint8Array([0, 255, 10]), name: "archive.dat", title: "archive.dat" });
  assert.ok(!Buffer.concat(run.output).toString().includes("content"));
});

for (const resolved of [false, true]) {
  test(`document creation delegates default and explicit vault selection (${resolved ? "resolved" : "allow"})`, async () => {
    for (const selector of [undefined, "Other", "other"]) {
      const backend = createObjectBackend({ vaults: [{ id: "work", name: "Workspace" }, { id: "other", name: "Other" }, { id: "private", name: "Private" }], defaultVault: "work" });
      const run = fixture(["document", "create", "-", "--format=json", ...(selector === undefined ? [] : ["--vault", selector])]);
      let approvals = 0;
      const command = createOp({ backend, authorize: () => resolved ? "ask" : "allow", authorizeResolution: () => true, approveResolved() { approvals++; return true; } });
      assert.equal((await command.execute(run.context)).exitCode, 0);
      assert.equal(approvals, resolved ? 1 : 0);
      assert.equal(JSON.parse(Buffer.concat(run.output).toString()).vault.id, selector === undefined ? "work" : "other");
      assert.equal(backend.snapshot().documents?.length, 1);
    }
  });

  test(`document creation preserves sole-vault and ambiguous-vault policy (${resolved ? "resolved" : "allow"})`, async () => {
    for (const multiple of [false, true]) {
      const backend = createObjectBackend({ vaults: [{ id: "work", name: "Workspace" }, ...(multiple ? [{ id: "other", name: "Other" }] : [])] });
      const run = fixture(["document", "create", "-", "--format=json"]);
      const command = createOp({ backend, authorize: () => resolved ? "ask" : "allow", authorizeResolution: () => true, approveResolved: () => true });
      assert.equal((await command.execute(run.context)).exitCode, multiple ? 1 : 0);
      assert.equal(backend.snapshot().documents?.length, multiple ? 0 : 1);
      if (!multiple) assert.equal(JSON.parse(Buffer.concat(run.output).toString()).vault.id, "work");
    }
  });
}

test("edit replaces bytes and only explicitly supplied metadata", async () => {
  const run = fixture(["document", "edit", "existing", "-", "--tags=", "--title=New"]);
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.deepEqual(run.requests[0]!.args, ["existing"]);
  assert.deepEqual(run.requests[0]!.input, { content: new Uint8Array([255, 0, 128]), title: "New", tags: [] });
});

test("get emits exact binary bytes even with JSON format", async () => {
  const run = fixture(["document", "get", "doc", "--format=json"]);
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from([255, 0, 128]));
});

test("get enforces file mode and overwrite policy through host", async () => {
  const run = fixture(["document", "get", "doc", "-o", "/output", "--file-mode=0640"]);
  run.fs.writeFileSync("/output", "existing");
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.equal(run.fs.readFileSync("/output", "utf8"), "existing");
  run.context.args = [...run.context.args, "--force"];
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.deepEqual(run.writes.at(-1), { mode: 0o640, overwrite: true });
  assert.deepEqual(run.fs.readFileSync("/output"), Buffer.from([255, 0, 128]));
  assert.equal(run.output.length, 0);
});

test("get creates a new destination with private permissions by default", async () => {
  const run = fixture(["document", "get", "doc", "-o", "/empty"]);
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.deepEqual(run.writes[0], { mode: 0o600, overwrite: false });
});

test("invalid modes and absent file capability fail before backend access", async () => {
  for (const mode of ["999", "-1", "40000000000", "", "0644junk"]) {
    const run = fixture(["document", "get", "doc", "-o", "/out", `--file-mode=${mode}`]);
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.requests.length, 0);
  }
  const run = fixture(["document", "get", "doc", "-o", "/out"]);
  delete run.context.writeFile;
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.equal(run.requests.length, 0);
});

test("binary terminal output requires force, redirected output does not", async () => {
  const run = fixture(["document", "get", "doc"]);
  run.context.stdout.isTTY = true;
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.equal(run.output.length, 0);
  run.context.args = [...run.context.args, "--force"];
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
});

test("byte limits cover stdin, file uploads and downloads", async () => {
  for (const args of [["document", "create", "-"], ["document", "create", "/file"], ["document", "get", "doc"]]) {
    const run = fixture(args, new Uint8Array([0, 1, 2]), 2);
    run.fs.writeFileSync("/file", Buffer.from([0, 1, 2]));
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.output.length, 0);
    if (args[1] === "create") assert.equal(run.requests.length, 0);
  }
});

test("reused stdin chunks are copied and empty documents remain valid", async () => {
  const run = fixture(["document", "create", "-"]);
  run.context.stdin = (async function* () { const bytes = new Uint8Array([255]); yield bytes; bytes[0] = 128; yield bytes; bytes[0] = 0; })();
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.deepEqual((run.requests[0]!.input as { content: Uint8Array }).content, new Uint8Array([255, 128]));
  run.context.stdin = (async function* () { yield new Uint8Array(); })();
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal((run.requests[1]!.input as { content: Uint8Array }).content.length, 0);
});

test("authorization denial precedes document IO and backend calls", async () => {
  const run = fixture(["document", "create", "/missing"]);
  let reads = 0;
  run.context.readFile = async () => { reads++; return new Uint8Array(); };
  const backend: OpBackend = { async execute() { throw new Error("must not execute"); } };
  const command = createOpCommand({ backend, authorize: () => "deny", handlers: createDocumentHandlers(backend) });
  assert.equal((await command.execute(run.context)).exitCode, 1);
  assert.equal(reads, 0);
});

test("object backend round-trips create, edit and get without decoding bytes", async () => {
  const run = fixture(["document", "create", "/input", "--format=json"]);
  run.fs.writeFileSync("/input", Buffer.from([0, 254, 255]));
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  const command = createOp({ backend });
  assert.equal((await command.execute(run.context)).exitCode, 0);
  const created = JSON.parse(Buffer.concat(run.output).toString()) as { id: string };
  run.output.length = 0;
  run.context.args = ["document", "get", created.id];
  assert.equal((await command.execute(run.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from([0, 254, 255]));
  run.output.length = 0;
  run.context.args = ["document", "edit", created.id, "-"];
  assert.equal((await command.execute(run.context)).exitCode, 0);
  run.output.length = 0;
  run.context.args = ["document", "get", created.id];
  assert.equal((await command.execute(run.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from([255, 0, 128]));
});

test("aborting file read prevents upload to backend", async () => {
  const run = fixture(["document", "create", "/input"]);
  const controller = new AbortController();
  run.context.signal = controller.signal;
  run.context.readFile = async () => { controller.abort(); return new Uint8Array([255]); };
  assert.equal((await run.command.execute(run.context)).exitCode, 130);
  assert.equal(run.requests.length, 0);
});

test("public document output refuses an existing file unless force is explicit", async () => {
  const bytes = new Uint8Array([255, 0, 129]);
  const backend = createObjectBackend({ documents: [{ id: "doc", content: bytes }] });
  const command = createOp({ backend });
  const run = fixture(["document", "get", "doc", "--out-file=/saved", "--file-mode=0600"]);
  run.fs.writeFileSync("/saved", "untouched");
  assert.equal((await command.execute(run.context)).exitCode, 1);
  assert.equal(run.fs.readFileSync("/saved", "utf8"), "untouched");
  run.context.args = [...run.context.args, "--force"];
  assert.equal((await command.execute(run.context)).exitCode, 0);
  assert.deepEqual(run.fs.readFileSync("/saved"), Buffer.from(bytes));
  assert.equal(run.output.length, 0);
});
