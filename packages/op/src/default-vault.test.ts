import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import type { OpBackendRequest, OpItem, OpObjectBackendOptions } from "./types.js";

const context = () => ({ signal: new AbortController().signal });
const create: OpBackendRequest = { resource: "item", action: "create", args: [], flags: {}, input: { title: "New", category: "LOGIN" } };

test("generic object seeds use the sole visible vault without native naming conventions", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "work", name: "Anything" }] });
  assert.equal((await backend.execute(create, context()) as OpItem).vault.id, "work");
  const prepared = await backend.prepareBinding([create], context());
  assert.deepEqual(prepared.targets.filter(target => target.resource === "vault").map(target => target.id), ["work"]);
  assert.equal((await backend.execute(create, { ...context(), binding: prepared.handle }) as OpItem).vault.id, "work");
  backend.cancelBinding(prepared.handle);
});

test("defaultVault is an explicit immutable seed ID that survives snapshots and respects explicit overrides", async () => {
  const options: OpObjectBackendOptions = { defaultVault: "WORK", vaults: [{ id: "private", name: "Private" }, { id: "work", name: "Anything" }] };
  const backend = createObjectBackend(options);
  options.defaultVault = "private";
  assert.equal((await backend.execute(create, context()) as OpItem).vault.id, "work");
  assert.equal(backend.snapshot().defaultVault, "work");
  const restored = createObjectBackend(backend.snapshot());
  assert.equal((await restored.execute(create, context()) as OpItem).vault.id, "work");
  assert.equal((await backend.execute({ ...create, input: { ...create.input as object, vault: "private" } }, context()) as OpItem).vault.id, "private");
  assert.equal((await backend.execute({ ...create, flags: { vault: "Private" }, input: { ...create.input as object, vault: "work" } }, context()) as OpItem).vault.id, "private");
});

test("missing or ambiguous default selection never guesses Private or publishes objects", async () => {
  for (const vaults of [[], [{ id: "private", name: "Private" }, { id: "other", name: "Other" }]]) {
    const backend = createObjectBackend({ vaults });
    const before = backend.snapshot();
    await assert.rejects(backend.execute(create, context()), { message: "Select a vault or configure defaultVault" });
    await assert.rejects(backend.prepareBinding([create], context()), { message: "Select a vault or configure defaultVault" });
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("defaultVault accepts existing IDs only", () => {
  for (const defaultVault of ["", "Missing", "Display name", true, { id: "work" }]) {
    assert.throws(() => createObjectBackend({ vaults: [{ id: "work", name: "Display name" }], defaultVault } as OpObjectBackendOptions), { message: "defaultVault must identify an existing vault ID" });
  }
});

test("default selection stays account-scoped and cannot leak a foreign seed default", async () => {
  const seed = { accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "A", account: "a" }, { id: "vb", name: "B", account: "b" }] };
  const request = { ...create, flags: { account: "b" } };
  const scoped = createObjectBackend(seed);
  assert.equal((await scoped.execute(request, context()) as OpItem).vault.id, "vb");
  const backend = createObjectBackend({ ...seed, defaultVault: "va" });
  const before = backend.snapshot();
  await assert.rejects(backend.execute(request, context()), { message: "Default vault is unavailable in the selected scope" });
  await assert.rejects(backend.prepareBinding([request], context()), { message: "Default vault is unavailable in the selected scope" });
  assert.deepEqual(backend.snapshot(), before);
  assert.equal((await backend.execute({ ...request, flags: { account: "b", vault: "vb" } }, context()) as OpItem).vault.id, "vb");
});

test("default-backed bindings pin vault identity and default references cannot become dangling", async () => {
  const backend = createObjectBackend({ defaultVault: "work", vaults: [{ id: "work", name: "Anything" }, { id: "other", name: "Other" }] });
  const prepared = await backend.prepareBinding([create], context());
  assert.deepEqual(prepared.targets.filter(target => target.resource === "vault").map(target => target.id), ["work"]);
  const before = backend.snapshot();
  await assert.rejects(backend.execute({ resource: "vault", action: "delete", args: ["work"], flags: {} }, context()), { message: "Cannot remove the configured default vault" });
  assert.deepEqual(backend.snapshot(), before);
  await backend.execute({ resource: "vault", action: "edit", args: ["work"], flags: { name: "Renamed" } }, context());
  await assert.rejects(backend.execute(create, { ...context(), binding: prepared.handle }));
  assert.deepEqual(backend.snapshot().items, []);
  assert.equal((await createObjectBackend(backend.snapshot()).execute(create, context()) as OpItem).vault.id, "work");
});

test("documents and bulk item creation use the same bound default selection", async () => {
  for (const operation of [
    { ...create, input: [{ title: "First", category: "LOGIN" }, { title: "Second", category: "LOGIN" }] },
    { resource: "document", action: "create", args: [], flags: {}, input: { name: "Synthetic", content: new Uint8Array([1, 2]) } }
  ] satisfies OpBackendRequest[]) {
    const backend = createObjectBackend({ defaultVault: "work", vaults: [{ id: "work", name: "Anything" }, { id: "other", name: "Other" }] });
    const prepared = await backend.prepareBinding([operation], context());
    assert.ok(prepared.targets.filter(target => target.resource === "vault").every(target => target.id === "work"));
    const result = await backend.execute(operation, { ...context(), binding: prepared.handle });
    for (const object of Array.isArray(result) ? result : [result]) assert.equal(object.vault.id, "work");
    backend.cancelBinding(prepared.handle);
  }
});
