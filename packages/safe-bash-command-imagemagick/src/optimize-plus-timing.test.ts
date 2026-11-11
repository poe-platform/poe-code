import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { delays: ["1x24", "1x24", "1x60"], timing: [[1, 24], [5, 100], [10, 100]] },
    { delays: ["1x24", "1x60", "1x24"], timing: [[1, 24], [5, 100], [10, 100]] },
    { delays: ["4x100", "4x100", "4x100"], timing: [[4, 100], [8, 100], [10, 100]] },
  ])(`${mode} normalizes merged OptimizePlus pause timing: $delays`, async ({ delays, timing }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = [...delays.flatMap(delay => ["-delay", delay, "xc:red"]),
      "-delay", "10x100", "xc:blue", "-layers", "OptimizePlus", "out.miff"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.miff") : files.get("out.miff")!;
    let offset = 0;
    for (const [delay, ticks] of timing) {
      const end = output.indexOf(26, offset);
      expect(end).toBeGreaterThan(offset);
      const header = new TextDecoder().decode(output.subarray(offset, end)).split("\n");
      expect(header).toContain(`delay=${delay}`);
      expect(header).toContain(`ticks-per-second=${ticks}`);
      const decoded = decodeImage(output.subarray(offset));
      offset = end + 1 + decoded.width * decoded.height * decoded.channels * (decoded.depth === "ushort" ? 2 : 1);
    }
    expect(offset).toBe(output.length);
  });
}
