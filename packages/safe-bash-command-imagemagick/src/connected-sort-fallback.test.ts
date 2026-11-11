import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
 for (const [defines, ids] of [
  [[], [0, 4, 6, 1, 2, 3, 5, 7]],
  [["sort=foo"], [0, 4, 6, 1, 2, 3, 5, 7]],
  [["sort=x", "sort=foo", "sort-order=increasing"], [0, 4, 6, 1, 2, 3, 5, 7]],
  [["sort=foo", "sort-order=decreasing"], [0, 4, 6, 1, 2, 3, 5, 7]],
  [["sort-order=ascending", "sort=x"], [0, 6, 2, 5, 3, 4, 1, 7]],
  [["sort-order=increasing", "sort=x"], [0, 6, 2, 5, 3, 4, 1, 7]],
  [["sort-order=decreasing", "sort-order=foo", "sort=x"], [0, 6, 2, 5, 3, 4, 1, 7]],
  [["sort=x", "sort=x=foo"], [0, 4, 6, 1, 2, 3, 5, 7]],
  [["sort=x", "sort-order=decreasing=foo"], [0, 6, 2, 5, 3, 4, 1, 7]],
  [["sort="], [0, 4, 6, 1, 2, 3, 5, 7]],
  [["sort=x", "sort-order="], [0, 6, 2, 5, 3, 4, 1, 7]],
 ] as const) {
  it(`preserves native sort fallbacks and label raster (${mode}, ${defines.join(", ") || "default"})`, async () => {
   const input = new TextEncoder().encode("P2\n5 4\n255\n0 0 0 0 255\n0 80 0 255 0\n0 0 80 0 0\n140 140 140 0 220\n");
   const output = new TextEncoder().encode("KEEP");
   const files = new Map([["in.pgm", input], ["out.raw", output]]);
   const fs = new MemoryFileSystem();
   await fs.writeFile("/in.pgm", input);
   await fs.writeFile("/out.raw", output);
   const args = ["in.pgm", "-define", "connected-components:verbose=true",
    ...defines.flatMap(define => ["-define", `connected-components:${define}`]),
    "-connected-components", "4", "-depth", "16", "-endian", "MSB", "gray:out.raw"];
   let stdout = "", stderr = "", exitCode: number;
   if (mode === "command") {
    ({ exitCode } = await createMagickCommand().execute({
     command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
     stdin: (async function* () {})(), signal: new AbortController().signal,
     stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
     stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    }));
   } else {
    ({ exitCode, stdout, stderr } = mode === "sync" ? runConvertCliSync(args, files)
     : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" }));
   }
   expect(stderr).toBe("");
   expect(exitCode).toBe(0);
   expect(stdout.trim().split("\n").slice(1).map(row => Number(row.trim().split(":")[0]))).toEqual(ids);
   expect(Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!).toString("hex"))
    .toBe("00000000000000000001000000020000000300040000000000050004000400060006000600040007");
  });
 }
}
