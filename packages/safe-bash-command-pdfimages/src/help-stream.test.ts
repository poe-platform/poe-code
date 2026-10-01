import { expect, it } from "vitest";
import type { CommandContext } from "safe-bash-contracts";
import { createPdfimagesCommand } from "./index.js";

for (const flag of ["-h", "-help", "--help", "-?", "-v", "--version"]) {
  it(`handles ${flag} without acquiring input`, async () => {
    let reads = 0;
    const context = {
      args: [flag], cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: { [Symbol.asyncIterator]() { reads++; throw new Error("stdin must not be acquired"); } },
      fs: { async readFile() { reads++; throw new Error("file must not be read"); } },
      stdout: { async write() {} }, stderr: { async write() {} }
    } as unknown as CommandContext;
    expect((await createPdfimagesCommand().execute(context)).exitCode).toBe(0);
    expect(reads).toBe(0);
  });
}
