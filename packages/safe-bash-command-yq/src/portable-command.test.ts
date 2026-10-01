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

for (const factory of [createYqCommand, createMikeYqCommand]) {
  test(`${factory.name} preserves retained output across multiple batches`, async () => {
    const values = Array.from({ length: 1800 }, (_, index) => `row_${index}_é🐈_match`);
    const input = new TextEncoder().encode(JSON.stringify(values));
    const chunks: Uint8Array[] = [];
    const result = await factory().execute({
      command: "yq", args: [".[]", "-o", "json", "-r", "-"],
      stdin: (async function* () { yield input; })(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
      env: {}, cwd: "/", fs: {}, signal: new AbortController().signal,
    } as unknown as CommandContext);
    assert.equal(result.exitCode, 0);
    assert.ok(chunks.length > 3);
    assert.equal(chunks.map(bytes => new TextDecoder().decode(bytes)).join(""), values.join("\n") + "\n");
  });
}
