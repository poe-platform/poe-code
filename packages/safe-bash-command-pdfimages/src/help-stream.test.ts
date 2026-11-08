import { expect, it } from "vitest";
import type { CommandContext } from "safe-bash-contracts";
import { createPdfimagesCommand } from "./index.js";

const cases = ["-h", "-help", "--help", "-?", "-v", "--version"].flatMap(flag =>
  [[flag], [flag, "-"], [flag, "in.pdf"]].map(args => ({ args, exitCode: 0 }))
);
cases.push(...[[], ["-list"], ["-"], ["in.pdf"], ["-list", "in.pdf", "out"]].map(args => ({ args, exitCode: 99 })));

for (const { args, exitCode } of cases) {
  it(`handles ${args.join(" ")} without acquiring input`, async () => {
    let reads = 0;
    const context = {
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: { [Symbol.asyncIterator]() { reads++; throw new Error("stdin must not be acquired"); } },
      fs: { async readFile() { reads++; throw new Error("file must not be read"); } },
      stdout: { async write() {} }, stderr: { async write() {} }
    } as unknown as CommandContext;
    expect((await createPdfimagesCommand().execute(context)).exitCode).toBe(exitCode);
    expect(reads).toBe(0);
  });
}
