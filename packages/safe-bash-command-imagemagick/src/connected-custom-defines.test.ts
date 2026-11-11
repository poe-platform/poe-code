import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
 for (const define of [undefined, "connected-components:foo=bar", "connected-components:foo", "connected-components:foo=a=b"]) {
  it(`preserves native labels and report order with ${define ?? "no custom define"} (${mode})`, async () => {
   const input = new TextEncoder().encode("P2\n5 4\n255\n0 0 0 0 255\n0 80 0 255 0\n0 0 80 0 0\n140 140 140 0 220\n");
   const sentinel = new TextEncoder().encode("KEEP");
   const files = new Map([["in.pgm", input], ["out.raw", sentinel]]);
   const fs = new MemoryFileSystem();
   await fs.writeFile("/in.pgm", input);
   await fs.writeFile("/out.raw", sentinel);
   const args = ["in.pgm", "-define", "connected-components:verbose=true",
    ...(define === undefined ? [] : ["-define", define]),
    "-connected-components", "4", "-depth", "16", "-endian", "MSB", "gray:out.raw"];
   let result;
   if (mode === "command") {
    let stdout = "", stderr = "";
    const execution = await createMagickCommand().execute({
     command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
     stdin: (async function* () {})(), signal: new AbortController().signal,
     stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
     stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    result = { ...execution, stdout, stderr };
   } else {
    result = mode === "sync" ? runConvertCliSync(args, files)
     : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
   }
   expect(result.stderr).toBe("");
   expect(result.exitCode).toBe(0);
   expect(result.stdout.trim().split("\n").slice(1).map(row => Number(row.trim().split(":")[0])))
    .toEqual([0, 4, 6, 1, 2, 3, 5, 7]);
   const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
   expect(Buffer.from(output).toString("hex"))
    .toBe("00000000000000000001000000020000000300040000000000050004000400060006000600040007");
  });
 }
}
