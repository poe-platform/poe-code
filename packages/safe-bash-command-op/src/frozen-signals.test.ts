import assert from "node:assert/strict";
import { test } from "node:test";
import { createManagedControlController } from "safe-bash-contracts/signals";
import { createObjectBackend, createOp } from "./index.js";

for (const [kind, createSignal] of [
  ["native", () => new AbortController().signal],
  ["managed", () => createManagedControlController().signal],
] as const) {
  for (const resolved of [false, true]) {
    for (const [args, input, expected] of [
      [["vault", "get", "vault", "--format=json"], "", '"id": "vault"'],
      [["item", "create", "-", "--format=json"], '{"title":"Created","category":"LOGIN"}', '"title": "Created"'],
      [["inject"], "TOKEN={{ op://vault/item/password }}", "TOKEN=synthetic-token"],
    ] as const) {
      test(`${args.join(" ")} supports frozen ${kind} signals with ${resolved ? "resolved approval" : "direct authorization"}`, async () => {
        const backend = createObjectBackend({
          vaults: [{ id: "vault", name: "Test" }],
          items: [{ id: "item", vault: "vault", title: "Test", fields: [{ id: "password", value: "synthetic-token" }] }],
        });
        const signal = Object.freeze(createSignal());
        let output = "";
        let errors = "";
        const command = createOp({ backend, authorize: () => resolved ? "ask" : "allow", authorizeResolution: () => true, approveResolved: () => true });
        const result = await command.execute({
          args, env: {}, signal,
          stdin: (async function* () { yield new TextEncoder().encode(input); })(),
          stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
        });
        assert.equal(result.exitCode, 0, errors);
        assert.ok(output.includes(expected), output);
      });
    }
  }

  test(`plugin selection and confirmation support frozen ${kind} signals`, async () => {
    const backend = createObjectBackend({ resources: { plugin: [{ id: "aws", defaults: [{ id: "default", scope: { kind: "global" }, configuration: {} }] }] } });
    const context = {
      signal: Object.freeze(createSignal()),
      selectPlugin: () => "aws", confirmPluginClear: () => true,
      pluginScope: { cwd: "/work", home: "/work" },
    };
    const inspected = await backend.execute({ resource: "plugin", action: "inspect", args: [], flags: {} }, context) as { id: string };
    assert.equal(inspected.id, "aws");
    await backend.execute({ resource: "plugin", action: "clear", args: ["aws"], flags: {} }, context);
    assert.deepEqual(backend.snapshot().resources?.plugin?.[0]?.defaults, []);
  });
}
