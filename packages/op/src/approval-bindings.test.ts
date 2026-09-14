import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend, createOp, type OpBackendRequest } from "./index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

for (const reassign of [false, true]) {
  test(reassign ? "approval invalidates when the approved item name is reassigned while permission is pending" : "unchanged approved item selection completes through the public API", async () => {
    const backend = createObjectBackend({
      vaults: [{ id: "vault", name: "Private" }],
      items: [
        { id: "first-id", title: "Approved Name", vault: "vault", fields: [{ id: "password", value: "synthetic-first" }] },
        { id: "second-id", title: "Other Name", vault: "vault", fields: [{ id: "password", value: "synthetic-second" }] },
      ],
    });
    const entered = deferred<unknown>();
    const permission = deferred<boolean>();
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const signal = new AbortController().signal;
    let canonical: OpBackendRequest | undefined;
    const command = createOp(Object.assign({
      backend,
      authorize(request: OpBackendRequest) { canonical = request; return "ask" as const; },
      approve() { throw new Error("Resolved approval must not use the literal callback"); },
    }, {
      authorizeResolution: () => true,
      approveResolved(approval: unknown) {
        entered.resolve(approval);
        return permission.promise;
      },
    }));
    const execution = command.execute({
      args: ["item", "get", "Approved Name", "--format", "json"], env: {}, signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    });
    try {
      const approved = await Promise.race([
        entered.promise,
        execution.then(result => { throw new Error(`Command settled before approval entry: ${result.exitCode}`); }),
      ]);
      assert.ok(canonical);
      const before = structuredClone(canonical);
      assert.ok(Object.isFrozen(approved));
      assert.ok(approved !== null && typeof approved === "object");
      assert.equal(Object.hasOwn(approved, "binding") || Object.hasOwn(approved, "handle"), false);
      assert.ok(Object.isFrozen(canonical));
      assert.ok(Object.isFrozen(canonical.args));
      assert.ok(Object.isFrozen(canonical.flags));
      assert.equal(stdout.length, 0);
      if (reassign) {
        await backend.execute({ resource: "item", action: "edit", args: ["first-id"], flags: { title: "Renamed" } }, { signal });
        await backend.execute({ resource: "item", action: "edit", args: ["second-id"], flags: { title: "Approved Name" } }, { signal });
        assert.deepEqual(backend.snapshot().items?.map(item => [item.id, item.title]), [["first-id", "Renamed"], ["second-id", "Approved Name"]]);
      }
      assert.deepEqual(canonical, before);
    } finally {
      permission.resolve(true);
      await execution;
    }
    const result = await execution;
    const output = Buffer.concat(stdout).toString();
    const errors = Buffer.concat(stderr).toString();
    assert.equal(errors.includes("synthetic-first") || errors.includes("synthetic-second"), false);
    const returnedId = output === "" ? undefined : (JSON.parse(output) as { id?: string }).id;
    if (reassign) {
      assert.deepEqual({ exitCode: result.exitCode, returnedId, outputBytes: Buffer.byteLength(output) }, { exitCode: 1, returnedId: undefined, outputBytes: 0 });
    } else {
      assert.equal(result.exitCode, 0);
      assert.equal(returnedId, "first-id");
    }
  });
}
