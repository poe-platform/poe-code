import assert from "node:assert/strict";
import { test } from "node:test";
import { createOp, createObjectBackend, type OpBackend, type OpBackendRequest, type OpCommandContext } from "./index.js";

const templates = ["First", "Second"].map(title => ({ title, category: "LOGIN", fields: [{ id: "password", type: "CONCEALED", value: "synthetic-secret" }] }));

function fixture(input: string, extra: string[] = [], backend: OpBackend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] }), literalApproval = false) {
  let output = "";
  let errors = "";
  let consumed = 0;
  const authorized: OpBackendRequest[] = [];
  const approved: OpBackendRequest[] = [];
  const controller = new AbortController();
  const context: OpCommandContext = {
    args: ["item", "create", "-", "--vault=Private", ...extra], env: {}, signal: controller.signal,
    stdin: (async function* () { consumed++; yield new TextEncoder().encode(input); })(),
    stdout: { async write(data) { output += Buffer.from(data).toString(); } },
    stderr: { async write(data) { errors += Buffer.from(data).toString(); } },
  };
  const command = createOp({ backend, authorize(request) { authorized.push(request); return literalApproval ? "ask" : "allow"; }, ...(literalApproval ? { approvalMode: "literal" as const, approve(request: OpBackendRequest) { approved.push(request); return true; } } : {}) });
  return { command, context, controller, authorized, approved, output: () => output, errors: () => errors, consumed: () => consumed };
}

test("bulk create forwards one ordered array after literal approval of the original request once", async () => {
  const calls: OpBackendRequest[] = [];
  const run = fixture(JSON.stringify(templates), ["password=override"], { async execute(request) { calls.push(request); return request.input; } }, true);
  assert.equal((await run.command.execute(run.context)).exitCode, 0, run.errors());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.input, templates);
  assert.deepEqual(calls[0]?.args, ["password=override"]);
  assert.equal(run.authorized.length, 1);
  assert.equal(run.approved.length, 1);
  assert.deepEqual(run.authorized[0]?.args, ["-", "password=override"]);
  assert.equal(run.authorized[0]?.input, undefined);
  assert.equal(run.output().includes("synthetic-secret"), false);
});

test("public bulk create applies assignments to every item and preserves result order", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  const run = fixture(JSON.stringify(templates), ["password=override", "--format=json", "--reveal"], backend);
  assert.equal((await run.command.execute(run.context)).exitCode, 0, run.errors());
  const created = backend.snapshot().items!;
  assert.deepEqual(created.map(item => item.title), ["First", "Second"]);
  assert.equal(new Set(created.map(item => item.id)).size, 2);
  assert.ok(created.every(item => item.fields?.find(field => field.id === "password")?.value === "override"));
  assert.deepEqual(JSON.parse(run.output()).map((item: { title: string }) => item.title), ["First", "Second"]);
});

test("bulk dry run previews every item without mutating the store", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  const before = backend.snapshot();
  const run = fixture(JSON.stringify(templates), ["--dry-run", "--format=json"], backend);
  assert.equal((await run.command.execute(run.context)).exitCode, 0, run.errors());
  assert.equal(JSON.parse(run.output()).length, 2);
  assert.deepEqual(backend.snapshot(), before);
});

test("late malformed templates produce no output or partial mutations", async () => {
  for (const invalid of [null, { title: 123, category: "LOGIN", fields: [] }, { title: "Bad", fields: "invalid" }]) {
    const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
    const before = backend.snapshot();
    const run = fixture(JSON.stringify([templates[0], invalid]), [], backend);
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.output(), "");
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("bulk authorization denial does not consume input or invoke backend", async () => {
  const run = fixture(JSON.stringify(templates));
  const command = createOp({ backend: { async execute() { assert.fail("backend must not execute"); } }, authorize: () => "deny" });
  assert.equal((await command.execute(run.context)).exitCode, 1);
  assert.equal(run.consumed(), 0);
  assert.equal(run.output(), "");
});

test("bulk attachments are read once and copied separately into each template", async () => {
  let reads = 0;
  let received: Record<string, unknown>[] = [];
  const run = fixture(JSON.stringify(templates), ["Docs.payload[file]=synthetic.bin"], { async execute(request) { received = request.input as Record<string, unknown>[]; return []; } });
  run.context.readFile = async () => { reads++; return new Uint8Array([0, 255, 65]); };
  assert.equal((await run.command.execute(run.context)).exitCode, 0, run.errors());
  assert.equal(reads, 1);
  const files = received.map(item => (item.files as { content: Uint8Array; section: { label: string } }[])[0]!);
  assert.equal(files.length, 2);
  assert.deepEqual(files[0]?.content, new Uint8Array([0, 255, 65]));
  assert.equal(files[0]?.section.label, "Docs");
  files[0]!.content[0] = 99;
  assert.equal(files[1]!.content[0], 0);
});

test("late attachment failure and cancellation never invoke the bulk backend", async () => {
  for (const abort of [false, true]) {
    const reads: string[] = [];
    const run = fixture(JSON.stringify(templates), ["first[file]=first", "second[file]=second"], { async execute() { assert.fail("backend must not execute"); } });
    run.context.readFile = async path => {
      reads.push(path);
      if (path === "second") {
        if (abort) run.controller.abort();
        throw new Error("Synthetic read failure");
      }
      return new Uint8Array([1]);
    };
    assert.equal((await run.command.execute(run.context)).exitCode, abort ? 130 : 1);
    assert.deepEqual(reads, ["first", "second"]);
    assert.equal(run.output(), "");
  }
});

test("duplicated item templates receive fresh IDs with consistent section links", async () => {
  const original = {
    id: "original", title: "Original", category: "LOGIN", vault: "vault",
    sections: [{ id: "old-section", label: "Custom" }],
    fields: [{ id: "old-field", label: "Custom value", type: "STRING", value: "synthetic", section: { id: "old-section" } }],
    files: [{ id: "old-file", name: "synthetic.bin", content: new Uint8Array([1, 2]), section: { id: "old-section" } }],
  };
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [original] });
  const input = { ...original, files: [{ ...original.files[0], content: undefined }] };
  const run = fixture(JSON.stringify([input, input]), ["--format=json"], backend);
  assert.equal((await run.command.execute(run.context)).exitCode, 0, run.errors());
  const copies = backend.snapshot().items!.filter(item => item.id !== "original");
  assert.equal(copies.length, 2);
  assert.equal(new Set(copies.map(item => item.id)).size, 2);
  for (const copy of copies) {
    const section = copy.sections?.find(value => value.label === "Custom");
    assert.ok(section);
    assert.notEqual(section.id, "old-section");
    const field = copy.fields?.find(value => value.label === "Custom value");
    assert.notEqual(field?.id, "old-field");
    assert.equal(field?.section?.id, section.id);
    const file = copy.files?.find(value => value.name === "synthetic.bin");
    assert.notEqual(file?.id, "old-file");
    assert.equal(file?.section?.id, section.id);
  }
  assert.equal(backend.snapshot().items!.find(item => item.id === "original")?.fields?.[0]?.id, "old-field");
});

test("bulk parsing rejects empty, nested, scalar, and malformed arrays before backend execution", async () => {
  for (const input of ["[]", "[[{}]]", '[{},"invalid"]', '[{}, {"late":', '{}\n{}']) {
    let calls = 0;
    const run = fixture(input, [], { async execute() { calls++; return []; } });
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.consumed(), 1);
    assert.equal(calls, 0);
    assert.equal(run.output(), "");
  }
});

test("bulk arrays are not silently accepted by item edit or template file input", async () => {
  for (const args of [["item", "edit", "existing"], ["item", "create", "--template=synthetic.json"]]) {
    let calls = 0;
    const run = fixture(args[1] === "edit" ? JSON.stringify(templates) : "", [], { async execute() { calls++; return []; } });
    run.context.args = args;
    run.context.readFile = async () => new TextEncoder().encode(JSON.stringify(templates));
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(calls, 0);
  }
});

test("public cross-account list get create pipeline remaps references to the explicit destination", async () => {
  const backend = createObjectBackend({
    accounts: [{ id: "source-account" }, { id: "destination-account" }],
    vaults: [{ id: "source-vault", name: "Source", account: "source-account" }, { id: "destination-vault", name: "Destination", account: "destination-account" }],
    items: ["first", "second"].map(id => ({
      id, title: id, category: "LOGIN", vault: "source-vault", account: "source-account",
      sections: [{ id: `${id}-section`, label: "Custom" }],
      fields: [{ id: `${id}-field`, label: "payload", type: "STRING", value: `${id}-synthetic`, section: { id: `${id}-section` } }],
    })),
  });
  async function execute(args: string[], input = "") {
    const run = fixture(input, [], backend);
    run.context.args = args;
    assert.equal((await run.command.execute(run.context)).exitCode, 0, run.errors());
    assert.equal(run.authorized.length, 1);
    return run.output();
  }
  const listed = await execute(["item", "list", "--account=source-account", "--format=json"]);
  const fetched = await execute(["item", "get", "-", "--account=source-account", "--format=json"], listed);
  const created = JSON.parse(await execute(["item", "create", "-", "--account=destination-account", "--vault=Destination", "--format=json"], fetched)) as { id: string; account: string }[];
  assert.equal(created.length, 2);
  assert.ok(created.every(item => item.account === "destination-account" && !["first", "second"].includes(item.id)));
  const projected = JSON.parse(await execute(["item", "get", "-", "--account=destination-account", "--fields=payload", "--format=json"], JSON.stringify(created))) as { value: string; reference: string }[];
  assert.equal(projected.length, 2);
  for (const field of projected) {
    assert.ok(field.reference.startsWith("op://destination-vault/"));
    assert.equal(await execute(["read", field.reference, "--account=destination-account", "--no-newline"]), field.value);
  }
  assert.deepEqual(backend.snapshot().items!.filter(item => item.account === "source-account").map(item => item.id), ["first", "second"]);
});

test("bulk duplication never publishes stale source references on remapped fields", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
  const input = {
    id: "source-item", title: "Duplicate", category: "LOGIN",
    fields: [{ id: "source-field", label: "payload", type: "STRING", value: "synthetic", reference: "op://source-vault/source-item/source-field" }],
  };
  const run = fixture(JSON.stringify([input, input]), ["--format=json"], backend);
  assert.equal((await run.command.execute(run.context)).exitCode, 0, run.errors());
  const created = JSON.parse(run.output()) as { id: string; fields: { id: string; label: string; reference?: string }[] }[];
  for (const item of created) {
    const field = item.fields.find(value => value.label === "payload")!;
    assert.notEqual(field.id, "source-field");
    if (field.reference !== undefined) assert.equal(field.reference, `op://vault/${item.id}/${field.id}`);
  }
  for (const item of backend.snapshot().items!) {
    const field = item.fields!.find(value => value.label === "payload")!;
    if (field.reference !== undefined) assert.equal(field.reference, `op://vault/${item.id}/${field.id}`);
  }
});
