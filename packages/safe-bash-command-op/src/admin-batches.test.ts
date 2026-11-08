import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { createOp } from "./index.js";
import type { OpAdminHook } from "./admin.js";
import type { OpBackendRequest } from "./types.js";

const commands = [
  ["group", "get"], ["group", "edit"], ["group", "delete"],
  ["user", "get"], ["user", "edit"], ["user", "delete"],
  ["user", "confirm"], ["user", "reactivate"], ["user", "suspend"]
] as const;

function fixture(resource: string, action: string, hook?: OpAdminHook) {
  return createObjectBackend({
    accounts: [{ id: "a" }, { id: "b" }],
    vaults: [{ id: "foreign-vault", name: "Foreign", account: "b" }],
    resources: {
      [resource]: [
        { id: "first", name: "First", account: "a", state: action === "confirm" ? "PENDING" : action === "reactivate" ? "SUSPENDED" : "ACTIVE" },
        { id: "second", name: "Second", account: "a", state: "ACTIVE" },
        { id: "foreign", name: "Foreign", account: "b", state: "ACTIVE" }
      ]
    },
    ...(hook ? { adminHooks: { [`${resource} ${action}`]: hook } } : {})
  });
}

for (const [resource, action] of commands) {
  test(`${resource} ${action} - treats singleton and array JSON as selectors, not mutation bodies`, async () => {
    const selector = { id: "FIRST", account: "b", vault: "foreign-vault", name: "Not a patch", state: "Invalid", metadata: { injected: true } };
    const snapshots = [];
    const outputs = [];
    for (const input of [selector, [selector]]) {
      const backend = fixture(resource, action);
      const before = backend.snapshot();
      let entered = 0;
      let output = "";
      let error = "";
      const command = createOp({ backend, authorize() { entered++; return "allow"; } });
      const result = await command.execute({
        args: [resource, action, "-", "--account", "a", "--format", "json", ...(action === "edit" ? ["--name", "From flags"] : [])],
        env: {}, signal: new AbortController().signal,
        stdin: (async function* () { yield new TextEncoder().encode(JSON.stringify(input)); })(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } }
      });
      assert.equal(entered, 1);
      assert.equal(result.exitCode, 0, error);
      const after = backend.snapshot();
      const target = after.resources?.[resource]?.find(object => object.id === "first");
      if (action === "delete") assert.equal(target, undefined);
      else {
        assert.equal(target?.name, action === "edit" ? "From flags" : "First");
        assert.equal(target?.account, "a");
        assert.equal(target?.vault, undefined);
        assert.equal(target?.metadata, undefined);
        assert.equal(target?.state, action === "suspend" ? "SUSPENDED" : "ACTIVE");
      }
      assert.deepEqual(after.resources?.[resource]?.filter(object => object.id !== "first"), before.resources?.[resource]?.filter(object => object.id !== "first"));
      assert.deepEqual(after.accounts, before.accounts);
      assert.deepEqual(after.vaults, before.vaults);
      snapshots.push(after);
      outputs.push(output);
    }
    assert.deepEqual(snapshots[0], snapshots[1]);
    assert.equal(outputs[0], outputs[1]);
  });

  test(`${resource} ${action} - rejects every missing, foreign, or malformed selector before hooks or local publication`, async () => {
    for (const hooked of [false, true]) {
      let calls = 0;
      const backend = fixture(resource, action, hooked ? async (_request, _context, resources) => {
        calls++;
        assert.ok(!resources.get(resource)?.some(object => object.id === "foreign"));
        return {};
      } : undefined);
      const before = backend.snapshot();
      const request: OpBackendRequest = { resource, action, args: ["-"], flags: { account: "a", ...(action === "edit" ? { name: "Changed" } : {}) } };
      const context = { signal: new AbortController().signal };
      for (const input of ["first\nmissing", "first\nforeign", [{ id: "first" }, { id: "foreign" }], '{"id":"first"}{"id":', [{ id: "first" }, null]]) {
        await assert.rejects(backend.execute({ ...request, input }, context), error => {
          assert.ok(error instanceof Error);
          assert.ok(["Object not found", "Object selectors are required"].includes(error.message), error.message);
          return true;
        });
        assert.equal(calls, 0);
        assert.deepEqual(backend.snapshot(), before);
      }
      if (!hooked) await assert.rejects(backend.execute({ ...request, args: [], input: { id: "first" } }, context), { message: "One object selector is required" });
      if (hooked) {
        await backend.execute({ ...request, input: { id: "first", account: "b", vault: "foreign-vault" } }, context);
        assert.equal(calls, 1);
        assert.deepEqual(backend.snapshot(), before);
      }
    }
  });
}
