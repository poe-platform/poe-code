import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqCommand } from "./query.js";
import { createMikeYqCommand } from "./mike.js";
import type { CommandContext } from "safe-bash-contracts";

for (const factory of [createYqCommand, createMikeYqCommand]) for (const args of [[".a", "-o", "json", "-c"], [".a", "-o", "json", "-r"]]) {
  test(`yq ${factory.name} evaluates YAML without Buffer: ${args.join(" ")}`, async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
    const chunks: Uint8Array[] = [];
    const input = new TextEncoder().encode("a: é🐈\n");
    const command = factory();
    Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
    try {
      const result = await command.execute({ command: "yq", args: [...args, "-"],
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
        env: {}, cwd: "/", fs: {}, signal: new AbortController().signal,
      } as unknown as CommandContext);
      assert.equal(result.exitCode, 0);
      assert.ok(chunks.some(bytes => new TextDecoder().decode(bytes).includes("é🐈")));
    } finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
  });
}
