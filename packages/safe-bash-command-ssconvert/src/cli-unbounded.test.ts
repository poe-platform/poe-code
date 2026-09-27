import { expect, it } from "vitest";
import { runCommand } from "./cli.js";
import type { Engine } from "./contracts.js";

for (const limits of [{}, { argumentBytes: 8 }, { commandOutputBytes: 8 }]) {
  it(`CLI only enforces explicitly provided limits ${JSON.stringify(limits)}`, async () => {
    const output: Uint8Array[] = [];
    const text = 'x'.repeat(1024 * 1024 + 1);
    const result = await runCommand(['--version', text], { limits } as Engine, {
      signal: new AbortController().signal,
      stdout: { async write(bytes) { output.push(bytes); } }, stderr: { async write() {} }
    }, { version: text, help: '' });
    expect(result.exitCode).toBe(Object.keys(limits).length ? 1 : 0);
    if (!Object.keys(limits).length) expect(output[0]!.length).toBe(text.length);
  });
}
