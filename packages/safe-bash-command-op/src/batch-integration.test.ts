import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { createOp, renderOpOutput } from "./index.js";
import type { OpBackendRequest } from "./types.js";
import type { OpResolvedApproval } from "./cli.js";

function fixture() {
  return createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "Source", account: "a" }, { id: "vb", name: "Foreign", account: "b" }, { id: "dest", name: "Destination", account: "a" }, { id: "empty", name: "Empty", account: "a" }], items: [{ id: "first", title: "First", vault: "va", fields: [{ id: "password", label: "password", type: "CONCEALED", value: "first-secret" }] }, { id: "second", title: "Second", vault: "va", fields: [{ id: "password", label: "password", type: "CONCEALED", value: "second-secret" }] }, { id: "foreign", title: "Foreign", vault: "vb", fields: [{ id: "password", value: "foreign-secret" }] }], resources: { group: [{ id: "group", name: "Team", account: "a" }], "vault group": [{ id: "grant1", vault: "va", group: "group", permissions: ["view_items"] }, { id: "grant2", vault: "dest", group: "group", permissions: ["view_items"] }] } });
}

async function run(backend: ReturnType<typeof fixture>, args: string[], input: string, allow = true, mode: "allow" | "literal" | "resolved" = allow ? "allow" : "resolved") {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const approved: OpBackendRequest[] = [];
  const resolved: OpResolvedApproval[] = [];
  const executed: OpBackendRequest[] = [];
  let boundExecutions = 0;
  let resolutionEntered = 0;
  let authorized = 0;
  const command = createOp({
    backend: { ...backend, async execute(request, context) { executed.push(request); if (context.binding) boundExecutions++; return backend.execute(request, context); } },
    approvalMode: mode === "literal" ? "literal" : "resolved",
    authorize() { authorized++; return mode === "allow" ? "allow" : "ask"; },
    approve(request) { approved.push(request); return allow; },
    authorizeResolution() { resolutionEntered++; return true; },
    approveResolved(manifest) { resolved.push(manifest); return allow; }
  });
  const result = await command.execute({ args, env: {}, signal: new AbortController().signal, stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  const error = Buffer.concat(stderr).toString();
  assert.ok(!error.includes("Resolved approval is unsupported"), error);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: error, authorized, approved, resolved, resolutionEntered, executed, boundExecutions };
}

test("public vault get batches use parsed stdin and approve the canonical request once", async () => {
  for (const input of ['[{"id":"va"},{"id":"dest"}]', '{"id":"va"}\n{"id":"dest"}', '{"id":"va"}{"id":"dest"}', "Source\nDestination\n"]) {
    const result = await run(fixture(), ["vault", "get", "-", "--account", "a", "--format", "json"], input, true, "literal");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).map((value: { id: string }) => value.id), ["va", "dest"]);
    assert.equal(result.authorized, 1);
    assert.equal(result.approved.length, 1);
    assert.deepEqual(result.approved[0]?.args, ["-"]);
  }
});

test("document delete stdin batches archive or delete with one approval and preserve other accounts", async () => {
  for (const archive of [false, true]) {
    for (const input of ['[{"id":"first"},{"id":"second"}]', '{"id":"first"}{"id":"second"}', "First\nSecond"]) {
      const backend = createObjectBackend({
        accounts: [{ id: "a" }, { id: "b" }],
        vaults: [{ id: "va", name: "Documents", account: "a" }, { id: "vb", name: "Foreign", account: "b" }],
        documents: [{ id: "first", name: "First", vault: "va" }, { id: "second", name: "Second", vault: "va" }, { id: "foreign", vault: "vb" }]
      });
      const result = await run(backend, ["document", "delete", "-", "--account", "a", "--vault", "Documents", ...(archive ? ["--archive"] : [])], input, true, "literal");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.authorized, 1);
      assert.equal(result.approved.length, 1);
      assert.deepEqual(result.approved[0]?.args, ["-"]);
      assert.deepEqual(backend.snapshot().documents?.map(document => [document.id, document.state]), [["first", archive ? "ARCHIVED" : "DELETED"], ["second", archive ? "ARCHIVED" : "DELETED"], ["foreign", undefined]]);
    }
  }
});

test("document batches validate all selectors and approval before publishing changes", async () => {
  const backend = createObjectBackend({
    accounts: [{ id: "a" }, { id: "b" }],
    vaults: [{ id: "va", name: "Documents", account: "a" }, { id: "vb", name: "Foreign", account: "b" }],
    documents: [{ id: "first", vault: "va", state: "ARCHIVED" }, { id: "foreign", vault: "vb" }]
  });
  const before = backend.snapshot();
  const args = ["document", "delete", "-", "--account", "a"];
  for (const input of ["first\nmissing", "first\nforeign", '{"id":"first"}{"id":', '[{"id":"first"},null]']) {
    const result = await run(backend, args, input, true, "resolved");
    assert.equal(result.exitCode, 1);
    assert.equal(result.resolutionEntered, 1);
    assert.equal(result.resolved.length, 0);
    assert.equal(result.executed.length, 0);
    assert.ok(!result.stderr.includes("unsupported"), result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(backend.snapshot(), before);
  }
  const denied = await run(backend, args, "first", false);
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.resolved.length, 1);
  assert.deepEqual(denied.resolved[0]?.targets.filter(target => target.resource === "document").map(target => target.id), ["first"]);
  assert.equal(denied.executed.length, 0);
  assert.deepEqual(backend.snapshot(), before);
  const deleted = await run(backend, args, "FIRST\nfirst", true, "resolved");
  assert.equal(deleted.exitCode, 0, deleted.stderr);
  assert.equal(deleted.resolved.length, 1);
  assert.equal(deleted.executed.length, 1);
  assert.equal(deleted.boundExecutions, 1);
  assert.deepEqual(deleted.resolved[0]?.targets.filter(target => target.resource === "document").map(target => target.id), ["first", "first"]);
  assert.equal(backend.snapshot().documents?.[0]?.state, "DELETED");
});

test("vault edit batches use only selectors from stdin and apply flags atomically", async () => {
  const backend = fixture();
  const args = ["vault", "edit", "-", "--account", "a", "--description", "Updated", "--travel-mode", "on", "--format", "json"];
  const before = backend.snapshot();
  for (const input of ["va\nmissing", "va\nvb"]) {
    assert.equal((await run(backend, args, input)).exitCode, 1);
    assert.deepEqual(backend.snapshot(), before);
  }
  const result = await run(backend, args, '[{"id":"va","name":"Must not replace"},{"id":"dest"}]');
  assert.equal(result.exitCode, 0, result.stderr);
  const edited = JSON.parse(result.stdout) as Record<string, unknown>[];
  assert.deepEqual(edited.map(value => [value.id, value.name, value.description, value["travel-mode"]]), [
    ["va", "Source", "Updated", "on"], ["dest", "Destination", "Updated", "on"]
  ]);
  assert.equal(result.executed.length, 1);
  const single = await run(backend, args, '{"id":"va","account":"b","vault":"vb","name":"Ignored metadata"}');
  assert.equal(single.exitCode, 0, single.stderr);
  assert.equal(JSON.parse(single.stdout)[0].name, "Source");
  const after = backend.snapshot();
  assert.equal((await run(backend, ["vault", "edit", "-", "--account", "a", "--travel-mode", "invalid"], "va\ndest")).exitCode, 1);
  assert.deepEqual(backend.snapshot(), after);
});

test("public item get preserves batch order without leaking another account", async () => {
  const backend = fixture();
  const result = await run(backend, ["item", "get", "-", "--account", "a", "--format", "json"], "second\nfirst");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).map((value: { id: string }) => value.id), ["second", "first"]);
  const failed = await run(backend, ["item", "get", "-", "--account", "a", "--format", "json"], "first\nforeign");
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.stdout, "");
});

test("public item get accepts documented stdin without an explicit dash selector", async () => {
  const backend = fixture();
  const args = ["item", "get", "--account", "a", "--format", "json"];
  const result = await run(backend, args, '[{"id":"second"},{"id":"first"}]');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).map((value: { id: string }) => value.id), ["second", "first"]);
  assert.equal(result.executed.length, 1);
  assert.deepEqual(result.executed[0]?.args, []);
  for (const input of ["", "first\nforeign", "first\nmissing"]) {
    const failed = await run(backend, args, input);
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.stdout, "");
  }
});

test("public single and bulk item pipelines copy into an explicit destination without altering either account's existing items", async () => {
  for (const bulk of [false, true]) {
    const backend = fixture();
    const before = backend.snapshot();
    const source = await run(backend, ["item", "get", ...(bulk ? ["-"] : ["first"]), "--account", "a", "--format", "json"], bulk ? "first\nsecond" : "");
    assert.equal(source.exitCode, 0, source.stderr);
    const args = ["item", "create", "-", "--account", "b", "--vault", "Foreign", "--format", "json"];
    const denied = await run(backend, args, source.stdout, false);
    assert.equal(denied.exitCode, 1);
    assert.equal(denied.resolved.length, 1);
    assert.equal(denied.executed.length, 0);
    assert.deepEqual(backend.snapshot(), before);
    const copied = await run(backend, args, source.stdout);
    assert.equal(copied.exitCode, 0, copied.stderr);
    assert.equal(copied.executed.length, 1);
    const result = JSON.parse(copied.stdout);
    const copies = (bulk ? result : [result]) as { id: string; account: string; vault: { id: string } }[];
    assert.equal(copies.length, bulk ? 2 : 1);
    assert.ok(copies.every(copy => copy.account === "b" && copy.vault.id === "vb"));
    const after = backend.snapshot();
    assert.deepEqual(after.items?.filter(item => before.items?.some(original => original.id === item.id)), before.items);
    assert.deepEqual(after.vaults, before.vaults);
    assert.deepEqual(after.accounts, before.accounts);
    assert.deepEqual(after.resources, before.resources);
  }
});

test("vault and item batch deletion validate every target before changing state", async () => {
  for (const [resource, valid, invalid] of [["vault", "empty", "missing"], ["vault", "empty", "va"], ["item", "first", "missing"], ["item", "first", "foreign"]]) {
    const backend = fixture();
    const before = backend.snapshot();
    const result = await run(backend, [resource!, "delete", "-", "--account", "a"], `${valid}\n${invalid}`);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(backend.snapshot(), before);
    assert.equal(result.stdout, "");
  }
  const backend = fixture();
  assert.equal((await run(backend, ["item", "delete", "-", "--account", "a", "--archive"], "first\nsecond")).exitCode, 0);
  assert.deepEqual(backend.snapshot().items?.map(item => [item.id, item.state]), [["first", "ARCHIVED"], ["second", "ARCHIVED"], ["foreign", undefined]]);
  assert.equal((await run(backend, ["vault", "delete", "-", "--account", "a"], "empty\nempty")).exitCode, 0);
  assert.deepEqual(backend.snapshot().vaults?.map(vault => vault.id), ["va", "vb", "dest"]);
});

test("public batch moves publish new IDs only after all source targets validate", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  const args = ["item", "move", "-", "--account", "a", "--destination-vault", "dest", "--format", "json"];
  assert.equal((await run(backend, args, "first\nmissing")).exitCode, 1);
  assert.deepEqual(backend.snapshot(), before);
  const result = await run(backend, args, "first\nsecond");
  assert.equal(result.exitCode, 0, result.stderr);
  const moved = JSON.parse(result.stdout) as { id: string; vault: { id: string } }[];
  assert.equal(moved.length, 2);
  assert.ok(moved.every(item => !["first", "second"].includes(item.id) && item.vault.id === "dest"));
  assert.ok(backend.snapshot().items?.filter(item => ["first", "second"].includes(item.id)).every(item => item.state === "DELETED"));
});

test("documented vault-group relation list batches include every vault", async () => {
  const result = await run(fixture(), ["vault", "group", "list", "-", "--account", "a", "--format", "json"], "va\ndest");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).map((value: { id: string }) => value.id), ["group", "group"]);
});

test("denied batch approval preserves state and template stdin remains a template", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  const denied = await run(backend, ["item", "delete", "-", "--account", "a"], "first\nsecond", false);
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.resolutionEntered, 1);
  assert.equal(denied.resolved.length, 1);
  assert.deepEqual(denied.resolved[0]?.targets.filter(target => target.resource === "item" && target.kind === "object").map(target => target.id), ["first", "second"]);
  assert.equal(denied.executed.length, 0);
  assert.ok(denied.stderr.includes("permission denied"), denied.stderr);
  assert.deepEqual(backend.snapshot(), before);
  const template = JSON.stringify({ title: "From template", category: "LOGIN", fields: [{ id: "username", type: "STRING", value: "alice" }] });
  const created = await run(backend, ["item", "create", "-", "--account", "a", "--vault", "va", "--format", "json"], template);
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).title, "From template");
});

test("batch field projections retain JSON values and conceal human output", async () => {
  for (const format of ["json", "human-readable"]) {
    const result = await run(fixture(), ["item", "get", "-", "--account", "a", "--fields", "password", "--format", format], "first\nsecond");
    assert.equal(result.exitCode, 0, result.stderr);
    if (format === "json") assert.deepEqual(JSON.parse(result.stdout).map((field: { value: string }) => field.value), ["first-secret", "second-secret"]);
    else {
      assert.ok(!result.stdout.includes("first-secret"));
      assert.ok(!result.stdout.includes("second-secret"));
    }
  }
});

test("batch OTP projection composes with public output", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: ["first", "second"].map(id => ({ id, title: id, vault: "vault", fields: [{ id: "otp", type: "OTP", value: "JBSWY3DPEHPK3PXP" }] })) });
  const result = await run(backend, ["item", "get", "-", "--otp"], "first\nsecond");
  assert.equal(result.exitCode, 0, result.stderr);
  const codes = result.stdout.trim().split("\n");
  assert.equal(codes.length, 2);
  assert.ok(codes.every(code => code.length === 6 && [...code].every(character => character >= "0" && character <= "9")));
});

test("batch OTP rendering rejects empty or partially invalid results", () => {
  for (const value of [[], ["123456", "private-not-an-otp"], ["123456", 123456]]) {
    assert.throws(() => renderOpOutput(value, { resource: "item", action: "get", args: ["-"], flags: { otp: true } }), {
      message: "backend did not return a generated one-time password"
    });
  }
});

test("batch validation is atomic without accounts and rejects malformed trailing JSON", async () => {
  for (const input of ["first\nmissing", '{"id":"first"}{"id":', '[{"id":"first"},null]']) {
    const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "first", title: "First", vault: "vault" }] });
    const before = backend.snapshot();
    const result = await run(backend, ["item", "delete", "-"], input);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("batch hooks receive one canonical invocation and never receive foreign or missing selectors", async () => {
  const backend = fixture();
  const observed: OpBackendRequest[] = [];
  const context = { signal: new AbortController().signal, adminHooks: { "item delete": async (request: OpBackendRequest, _context: unknown, resources: ReadonlyMap<string, readonly { id: string }[]>) => {
    observed.push(request);
    assert.ok(!resources.get("item")?.some(item => item.id === "foreign"));
    return {};
  } } };
  const request = { resource: "item", action: "delete", args: ["-"], flags: { account: "a" }, input: "first\nsecond" };
  await backend.execute(request, context);
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], request);
  for (const input of ["first\nforeign", "first\nmissing", '{"id":"first"}{']) await assert.rejects(backend.execute({ ...request, input }, context));
  await assert.rejects(backend.execute({ ...request, flags: { account: "a", vault: "dest" } }, context));
  assert.equal(observed.length, 1);
});

test("batch archived selectors retain ID-only access and validate vault filters", async () => {
  const backend = fixture();
  await backend.execute({ resource: "item", action: "edit", args: ["first"], flags: { account: "a", title: "Archived title" } }, { signal: new AbortController().signal });
  await run(backend, ["item", "delete", "first", "--archive", "--account", "a"], "");
  assert.equal((await run(backend, ["item", "get", "-", "--account", "a"], "FIRST\nsecond")).exitCode, 0);
  assert.equal((await run(backend, ["item", "get", "-", "--account", "a"], "Archived title\nsecond")).exitCode, 1);
  const before = backend.snapshot();
  const failed = await run(backend, ["item", "delete", "-", "--account", "a", "--vault", "dest"], "first\nsecond");
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(backend.snapshot(), before);
});
