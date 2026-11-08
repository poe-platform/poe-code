import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend, createOp, type OpBackendRequest, type OpObject } from "./index.js";

const context = { signal: new AbortController().signal };
const graph: Readonly<Record<string, readonly string[]>> = {
  create_items: ["view_items"],
  view_and_copy_passwords: ["view_items"],
  edit_items: ["view_and_copy_passwords", "view_items"],
  archive_items: ["edit_items", "view_and_copy_passwords", "view_items"],
  delete_items: ["edit_items", "view_and_copy_passwords", "view_items"],
  view_item_history: ["view_and_copy_passwords", "view_items"],
  import_items: ["create_items", "view_items"],
  export_items: ["view_item_history", "view_and_copy_passwords", "view_items"],
  copy_and_share_items: ["view_item_history", "view_and_copy_passwords", "view_items"],
  print_items: ["view_item_history", "view_and_copy_passwords", "view_items"],
};

function fixture(principal: "user" | "group" = "user", permissions: readonly string[] = []) {
  const backend = createObjectBackend({
    accounts: [{ id: "account" }], vaults: [{ id: "vault", name: "Work" }],
    resources: { [principal]: [{ id: "member", name: "Member" }], [`vault ${principal}`]: permissions.length ? [{ id: "grant", vault: "vault", [principal]: "member", permissions }] : [] },
  });
  const change = (action: string, requested?: readonly string[], flags: OpBackendRequest["flags"] = {}) => backend.execute({ resource: `vault ${principal}`, action, args: [], flags: { vault: "vault", [principal]: "member", ...flags, ...(requested === undefined ? {} : { permissions: requested }) } }, context);
  return { backend, change };
}

for (const principal of ["user", "group"] as const) {
  for (const [permission, requirements] of Object.entries(graph)) {
    test(`${principal}: ${permission} requires every cumulative prerequisite without implicit grants`, async () => {
      for (const missing of requirements) {
        const { backend, change } = fixture(principal);
        const before = backend.snapshot();
        await assert.rejects(change("grant", [permission, ...requirements.filter(required => required !== missing)], { "no-input": true }));
        assert.deepEqual(backend.snapshot(), before);
      }
      const { change } = fixture(principal);
      const granted = await change("grant", [permission, ...requirements], { "no-input": true }) as OpObject;
      assert.deepEqual(new Set(granted.permissions as string[]), new Set([permission, ...requirements]));
    });

    test(`${principal}: revoking a prerequisite also requires revoking granted ${permission}`, async () => {
      for (const dependency of requirements) {
        const { backend, change } = fixture(principal, [permission, ...requirements]);
        const before = backend.snapshot();
        await assert.rejects(change("revoke", [dependency], { "no-input": true }));
        assert.deepEqual(backend.snapshot(), before);
      }
      const { backend, change } = fixture(principal, [permission, ...requirements]);
      await change("revoke", [permission, ...requirements], { "no-input": true });
      assert.deepEqual(backend.snapshot().resources![`vault ${principal}`], []);
    });
  }
}

test("existing prerequisites satisfy an incremental grant and revoking a leaf preserves its parents", async () => {
  const { backend, change } = fixture("user", ["view_items", "view_and_copy_passwords", "edit_items"]);
  await change("grant", ["delete_items"]);
  await change("revoke", ["delete_items"]);
  assert.deepEqual(new Set(backend.snapshot().resources!["vault user"]![0]!.permissions as string[]), new Set(["view_items", "view_and_copy_passwords", "edit_items"]));
});

test("umbrella permissions expand only their documented scope and still require prerequisites", async () => {
  const { backend, change } = fixture();
  await assert.rejects(change("grant", ["allow_editing"]));
  assert.deepEqual(backend.snapshot().resources!["vault user"], []);
  const viewing = await change("grant", ["allow_viewing"]) as OpObject;
  assert.deepEqual(new Set(viewing.permissions as string[]), new Set(["view_items", "view_and_copy_passwords", "view_item_history"]));
  const editing = await change("grant", ["allow_editing"]) as OpObject;
  assert.deepEqual(new Set(editing.permissions as string[]), new Set(["view_items", ...Object.keys(graph), "move_items"]));
  await assert.rejects(change("revoke", ["allow_viewing"]));
  await change("revoke", ["allow_editing"]);
  assert.deepEqual(new Set(backend.snapshot().resources!["vault user"]![0]!.permissions as string[]), new Set(["view_items", "view_and_copy_passwords", "view_item_history"]));
  await change("revoke", ["allow_viewing"]);
  assert.deepEqual(backend.snapshot().resources!["vault user"], []);
});

test("manage_vault and allow_managing require no viewing or editing rights", async () => {
  for (const permission of ["manage_vault", "allow_managing"]) {
    const { change } = fixture();
    assert.deepEqual((await change("grant", [permission]) as OpObject).permissions, ["manage_vault"]);
  }
});

test("granular revokes from seeded umbrellas preserve other scope without stale umbrella grants", async () => {
  const { backend, change } = fixture("group", ["allow_viewing", "allow_editing", "allow_managing"]);
  await change("revoke", ["delete_items"]);
  const remaining = backend.snapshot().resources!["vault group"]![0]!.permissions as string[];
  assert.equal(remaining.includes("delete_items"), false);
  assert.equal(remaining.includes("allow_editing"), false);
  assert.ok(remaining.includes("archive_items"));
  assert.ok(remaining.includes("manage_vault"));
  await assert.rejects(change("revoke", ["view_items"]));
});

test("move_items is derived only while all six documented prerequisites remain", async () => {
  const moving = ["view_items", "edit_items", "archive_items", "view_and_copy_passwords", "view_item_history", "copy_and_share_items"];
  for (const missing of ["archive_items", "copy_and_share_items"]) {
    const { change } = fixture();
    assert.equal(((await change("grant", moving.filter(permission => permission !== missing)) as OpObject).permissions as string[]).includes("move_items"), false);
    assert.equal(((await change("grant", [missing]) as OpObject).permissions as string[]).includes("move_items"), true);
    assert.equal(((await change("revoke", [missing]) as OpObject).permissions as string[]).includes("move_items"), false);
  }
});

test("vault permission filters understand umbrella grants and requirements", async () => {
  const { backend } = fixture("user", ["allow_viewing"]);
  for (const permission of ["view_items", "view_and_copy_passwords", "view_item_history", "allow_viewing"]) {
    const listed = await backend.execute({ resource: "vault", action: "list", args: [], flags: { user: "member", permission: [permission] } }, context) as OpObject[];
    assert.equal(listed.length, 1);
  }
  assert.deepEqual(await backend.execute({ resource: "vault", action: "list", args: [], flags: { user: "member", permission: ["allow_editing"] } }, context), []);
});

test("no-input never authorizes missing dependencies and plain object seeds do not invent account plans", async () => {
  for (const noInput of [undefined, false, true]) {
    const { backend } = fixture();
    const before = backend.snapshot();
    const errors: Uint8Array[] = [];
    const result = await createOp({ backend }).execute({
      args: ["vault", "user", "grant", "--vault", "vault", "--user", "member", "--permissions", "edit_items", ...(noInput === undefined ? [] : [`--no-input=${noInput}`])],
      env: {}, signal: context.signal, stdin: (async function* () {})(), stdout: { async write() { assert.fail("Invalid grant must not produce output"); } }, stderr: { async write(bytes) { errors.push(bytes); } },
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(backend.snapshot(), before);
    assert.ok(Buffer.concat(errors).toString().includes("permission"));
  }
});

test("unknown permissions and missing grant permissions cannot change stored access", async () => {
  const { backend, change } = fixture("user", ["view_items"]);
  const before = backend.snapshot();
  for (const action of ["grant", "revoke"]) await assert.rejects(change(action, ["private-selector-secret"]), error => error instanceof Error && !error.message.includes("private-selector-secret"));
  await assert.rejects(change("grant"));
  assert.deepEqual(backend.snapshot(), before);
  await change("revoke");
  assert.deepEqual(backend.snapshot().resources!["vault user"], []);
});

test("scoped grants preserve foreign account rows and IDs", async () => {
  const backend = createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "A", account: "a" }, { id: "vb", name: "B", account: "b" }], resources: { user: [{ id: "ua", account: "a" }, { id: "ub", account: "b" }], "vault user": [{ id: "foreign", vault: "vb", user: "ub", account: "b", permissions: ["view_items"] }] } });
  const foreign = structuredClone(backend.snapshot().resources!["vault user"]![0]);
  const granted = await backend.execute({ resource: "vault user", action: "grant", args: [], flags: { account: "a", vault: "va", user: "ua", permissions: ["allow_viewing"] } }, context) as OpObject;
  assert.equal(granted.id.length, 26);
  assert.deepEqual(backend.snapshot().resources!["vault user"]!.find(entry => entry.id === "foreign"), foreign);
});
