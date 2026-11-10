import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
  // Native ImageMagick 7.1.2-35 Q16-HDRI: activate exposes uninitialized RGB canvas alpha.
  it.each([
    { size: "1x1", input: "xc:#2060b0", operations: ["-alpha", "activate"], expected: "2060b000" },
    { size: "3x2", input: "xc:#d04080", operations: ["-alpha", "activate"], expected: "d0408000".repeat(6) },
    { size: "1x1", input: "xc:#2060b0", operations: ["-alpha", "on"], expected: "2060b0ff" },
    { size: "1x1", input: "xc:#2060b0", operations: ["-alpha", "set"], expected: "2060b0ff" },
    { size: "1x1", input: "xc:#2060b038", operations: ["-alpha", "activate"], expected: "2060b038" },
    { size: "1x1", input: "canvas:#2060b0", operations: ["-alpha", "activate"], expected: "2060b000" },
    { size: "1x1", input: "xc:#2060b0ff", operations: ["-alpha", "activate"], expected: "2060b0ff" },
    { size: "1x1", input: "xc:#20206060b0b0ffff", operations: ["-alpha", "activate"], expected: "2060b0ff" },
    { size: "1x1", input: "xc:rgba(32,96,176,1)", operations: ["-alpha", "activate"], expected: "2060b0ff" },
    { size: "1x1", input: "xc:#2060b0", operations: [], expected: "2060b0ff" },
    { size: "1x1", input: "xc:#2060b0", operations: ["-alpha", "on", "-alpha", "deactivate", "-alpha", "activate"], expected: "2060b0ff" },
    { size: "1x1", input: "xc:#2060b038", operations: ["-alpha", "deactivate", "-alpha", "activate"], expected: "2060b038" },
  ])(`${execution}: $size $input $operations`, async ({ size, input, operations, expected }) => {
    const argv = ["-size", size, input, ...operations, "-depth", "8", "rgba:/out"];
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = execution === "command" ? await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : execution === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, execution === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, stderr).toBe(0);
    const bytes = execution === "buffered" || execution === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
  });
}
