import assert from "node:assert/strict";
import { test } from "node:test";
import { createOp, createObjectBackend, type OpCommandContext } from "./index.js";
import { createItemHandlers } from "./items.js";
import type { OpBackend, OpBackendRequest } from "./types.js";

const encoder = new TextEncoder();

function fixture(args: readonly string[], input = "") {
  const backend = createObjectBackend({
    vaults: [{ id: "vault", name: "Private" }],
    items: [{ id: "existing", title: "Old", vault: "vault", category: "LOGIN", fields: [{ id: "password", type: "CONCEALED", value: "old-secret" }] }]
  });
  const files = new Map<string, Uint8Array>();
  const reads: string[] = [];
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const controller = new AbortController();
  const context: OpCommandContext = {
    args, env: {}, signal: controller.signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { async write(data) { output.push(data.slice()); } },
    stderr: { async write(data) { errors.push(data.slice()); } },
    async readFile(path) {
      reads.push(path);
      const value = files.get(path);
      if (value === undefined) throw new Error("File not found");
      return value;
    },
    async writeFile() { assert.fail("item commands must not write host files"); }
  };
  return { backend, files, reads, context, controller, output: () => Buffer.concat(output).toString(), errors: () => Buffer.concat(errors).toString() };
}

test("public createOp loads item create templates and assignments override template fields", async () => {
  const run = fixture(["item", "create", "--template", "template.json", "--vault", "Private", "password=override"]);
  run.files.set("template.json", encoder.encode(JSON.stringify({ title: "Created", category: "LOGIN", tags: ["template"], fields: [{ id: "password", type: "CONCEALED", purpose: "PASSWORD", value: "template-secret" }], metadata: { retained: true } })));
  assert.deepEqual(await createOp({ backend: run.backend }).execute(run.context), { exitCode: 0 }, run.errors());
  const created = run.backend.snapshot().items?.find(item => item.title === "Created");
  assert.equal(created?.fields?.find(field => field.id === "password")?.value, "override");
  assert.deepEqual(created?.metadata, { retained: true });
  assert.deepEqual(created?.tags, ["template"]);
  assert.deepEqual(run.reads, ["template.json"]);
  assert.equal(run.output().includes("override"), false);
  assert.equal(run.output().includes("template-secret"), false);
});

test("public createOp loads edit templates and preserves unmodified metadata", async () => {
  const run = fixture(["item", "edit", "existing", "--template", "template.json", "--title", "Edited", "password=override"]);
  run.files.set("template.json", encoder.encode(JSON.stringify({ title: "Template", tags: ["updated"], fields: [{ id: "password", type: "CONCEALED", value: "template-secret" }] })));
  assert.deepEqual(await createOp({ backend: run.backend }).execute(run.context), { exitCode: 0 }, run.errors());
  const edited = run.backend.snapshot().items?.find(item => item.id === "existing");
  assert.equal(edited?.title, "Edited");
  assert.deepEqual(edited?.tags, ["updated"]);
  assert.equal(edited?.category, "LOGIN");
  assert.equal(edited?.fields?.[0]?.value, "override");
});

test("public createOp reads file attachments as bytes with escaped section and file names", async () => {
  const run = fixture(["item", "create", "--category", "LOGIN", "--title", "With file", "--vault", "Private", "Docs\\.Private.api\\=key[file]=key.bin"]);
  const bytes = new Uint8Array([0, 255, 10, 128]);
  run.files.set("key.bin", bytes);
  assert.deepEqual(await createOp({ backend: run.backend }).execute(run.context), { exitCode: 0 }, run.errors());
  const created = run.backend.snapshot().items?.find(item => item.title === "With file");
  const file = created?.files?.find(file => file.name === "api=key");
  assert.deepEqual(file?.content, bytes);
  assert.equal(file?.size, bytes.length);
  assert.equal(file?.section?.label, "Docs.Private");
  assert.ok(created?.sections?.some(section => section.id === file?.section?.id));
});

test("stdin JSON templates support create marker and edit with assignment precedence", async () => {
  for (const action of ["create", "edit"]) {
    const run = fixture(["item", action, action === "create" ? "-" : "existing", "--vault", "Private", "password=override"], JSON.stringify({ title: "From stdin", category: "LOGIN", fields: [{ id: "password", type: "CONCEALED", value: "stdin-secret" }] }));
    const command = createOp({ backend: run.backend, handlers: createItemHandlers(run.backend) });
    assert.deepEqual(await command.execute(run.context), { exitCode: 0 }, run.errors());
    const item = run.backend.snapshot().items?.find(item => item.title === "From stdin");
    assert.equal(item?.fields?.find(field => field.id === "password")?.value, "override");
    assert.equal(run.output().includes("stdin-secret"), false);
  }
});

test("template and stdin collisions and invalid JSON fail without backend calls", async () => {
  const cases = [
    { args: ["--template", "template.json"], input: "{}", file: "{}" },
    { args: ["-", "--template", "template.json"], input: "", file: "{}" },
    { args: ["-"], input: "", file: "" },
    { args: ["-"], input: "[null]", file: "" },
    { args: ["-"], input: "null", file: "" },
    { args: ["-"], input: '{"password":"private-value", bad}', file: "" }
  ];
  for (const entry of cases) {
    const run = fixture(["item", "create", ...entry.args], entry.input);
    run.files.set("template.json", encoder.encode(entry.file));
    let calls = 0;
    const backend: OpBackend = { async execute() { calls++; return {}; } };
    const result = await createOp({ backend, handlers: createItemHandlers(backend) }).execute(run.context);
    assert.equal(result.exitCode, 1);
    assert.equal(calls, 0);
    assert.equal(run.output(), "");
    assert.equal(run.errors().includes("private-value"), false);
  }
});

test("file assignments are consumed and passed as isolated bytes while other arguments stay literal", async () => {
  const run = fixture([]);
  const bytes = new Uint8Array([0, 255, 42]);
  run.files.set("a=b\\c.bin", bytes);
  let seen: OpBackendRequest | undefined;
  const backend: OpBackend = { async execute(request, options) { seen = request; assert.equal(options.signal, run.context.signal); return {}; } };
  const request: OpBackendRequest = { resource: "item", action: "edit", args: ["existing", "notesPlain=literal=a\\b", "Docs\\.Private.api\\=key[file]=a=b\\c.bin"], flags: { account: "work", "dry-run": true } };
  await createItemHandlers(backend)["item edit"]!(request, run.context);
  assert.deepEqual(seen?.args, ["existing", "notesPlain=literal=a\\b"]);
  assert.deepEqual(seen?.flags, { account: "work", "dry-run": true });
  assert.deepEqual(seen?.input, { files: [{ name: "api=key", size: 3, content: bytes, section: { label: "Docs.Private" } }] });
  assert.equal(request.args.length, 3);
  bytes.fill(7);
  assert.deepEqual((seen?.input as { files: { content: Uint8Array }[] }).files[0]?.content, new Uint8Array([0, 255, 42]));
});

test("dry-run previews item templates and attachments without changing backend state", async () => {
  const run = fixture(["item", "edit", "existing", "--template", "template.json", "--dry-run", "upload[file]=upload.bin"]);
  run.files.set("template.json", encoder.encode(JSON.stringify({ title: "Preview", fields: [{ id: "password", type: "CONCEALED", value: "preview-secret" }] })));
  run.files.set("upload.bin", encoder.encode("private-file-content"));
  const before = run.backend.snapshot();
  assert.deepEqual(await createOp({ backend: run.backend, handlers: createItemHandlers(run.backend) }).execute(run.context), { exitCode: 0 }, run.errors());
  assert.deepEqual(run.backend.snapshot(), before);
  assert.ok(run.output().includes("Preview"));
  assert.equal(run.output().includes("preview-secret"), false);
  assert.equal(run.output().includes("private-file-content"), false);
});

test("item output omits attachment content and uses shared field masking and reveal behavior", async () => {
  for (const reveal of [false, true]) {
    const run = fixture([]);
    const backend: OpBackend = { async execute() { return { id: "item", title: "Visible", fields: [{ id: "password", type: "CONCEALED", value: "field-secret" }], files: [{ id: "file", name: "attachment", size: 3, content: "file-secret" }] }; } };
    await createItemHandlers(backend)["item create"]!({ resource: "item", action: "create", args: [], flags: { reveal } }, run.context);
    assert.equal(run.output().includes("field-secret"), reveal);
    assert.equal(run.output().includes("file-secret"), false);
    assert.ok(run.output().includes("attachment"));
  }
});

test("missing file capability and attachment failures do not execute or emit partial items", async () => {
  for (const missingCapability of [false, true]) {
    const run = fixture([]);
    if (missingCapability) delete run.context.readFile;
    const backend: OpBackend = { async execute() { assert.fail("must not execute"); } };
    await assert.rejects(createItemHandlers(backend)["item create"]!({ resource: "item", action: "create", args: ["upload[file]=missing"], flags: {} }, run.context));
    assert.equal(run.output(), "");
  }
});

test("attachment parsing validates assignments before reading files", async () => {
  for (const value of ["file[file]", "file[file]=", "one.two.three[file]=path", "bad\\q[file]=path"]) {
    const run = fixture([]);
    const backend: OpBackend = { async execute() { assert.fail("must not execute"); } };
    await assert.rejects(createItemHandlers(backend)["item create"]!({ resource: "item", action: "create", args: [value], flags: {} }, run.context));
    assert.deepEqual(run.reads, []);
  }
});

test("cancellation stops a pending file read before backend execution", async () => {
  const run = fixture([]);
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  run.context.readFile = () => { entered(); return new Promise<Uint8Array>(() => {}); };
  const backend: OpBackend = { async execute() { assert.fail("must not execute"); } };
  const pending = createItemHandlers(backend)["item create"]!({ resource: "item", action: "create", args: ["upload[file]=path"], flags: {} }, run.context);
  await reading;
  const reason = new Error("cancelled read");
  run.controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(run.output(), "");
});

test("handler awaits output and propagates sink failures", async () => {
  const run = fixture([]);
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  let rejectWrite!: (error: Error) => void;
  run.context.stdout.write = async () => { entered(); await new Promise<void>((_resolve, reject) => { rejectWrite = reject; }); };
  const backend: OpBackend = { async execute() { return { id: "item" }; } };
  const pending = createItemHandlers(backend)["item create"]!({ resource: "item", action: "create", args: [], flags: {} }, run.context);
  await writing;
  const failure = new Error("closed output");
  rejectWrite(failure);
  await assert.rejects(pending, error => error === failure);
});

test("authorization denial happens before template and attachment IO", async () => {
  const run = fixture(["item", "create", "--template", "template.json", "upload[file]=upload.bin"]);
  const before = run.backend.snapshot();
  const command = createOp({ backend: run.backend, handlers: createItemHandlers(run.backend), authorize: () => "deny" });
  assert.equal((await command.execute(run.context)).exitCode, 1);
  assert.deepEqual(run.reads, []);
  assert.deepEqual(run.backend.snapshot(), before);
});

test("a later attachment failure does not persist or output a partially loaded item", async () => {
  const run = fixture([]);
  run.files.set("first.bin", encoder.encode("private-file-content"));
  let calls = 0;
  const backend: OpBackend = { async execute() { calls++; return {}; } };
  await assert.rejects(createItemHandlers(backend)["item create"]!({ resource: "item", action: "create", args: ["first[file]=first.bin", "second[file]=missing.bin"], flags: {} }, run.context));
  assert.equal(calls, 0);
  assert.deepEqual(run.reads, ["first.bin", "missing.bin"]);
  assert.equal(run.output(), "");
});
