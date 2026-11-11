import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P2\n5 4\n255\n0 0 0 0 255\n0 80 0 255 0\n0 0 80 0 0\n140 140 140 0 220\n");
const raster = "00000000000000000001000000020000000300040000000000050004000400060006000600040007";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
 for (const [sort, increasing, decreasing] of [
  ["x", [0, 6, 2, 5, 3, 4, 1, 7], [1, 7, 3, 4, 5, 2, 0, 6]],
  ["y", [0, 1, 2, 3, 4, 5, 6, 7], [6, 7, 5, 2, 3, 4, 0, 1]],
  ["width", [1, 2, 3, 5, 7, 4, 6, 0], [0, 6, 4, 1, 2, 3, 5, 7]],
  ["height", [1, 2, 3, 5, 6, 7, 0, 4], [0, 4, 1, 2, 3, 5, 6, 7]]
 ] as const) {
  for (const order of ["default", "increasing", "decreasing", "reset"] as const) {
   it(`sorts component reports by ${sort} with unchanged labels (${mode}, ${order})`, async () => {
    const files = new Map([["in.pgm", input], ["out.raw", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const args = ["in.pgm", "-define", "connected-components:verbose=true", "-define", `connected-components:sort=${sort}`,
     ...(order === "default" ? [] : ["-define", `connected-components:sort-order=${order === "reset" ? "decreasing" : order}`]),
     ...(order === "reset" ? ["+define", "connected-components:sort-order"] : []),
     "-connected-components", "4", "-depth", "16", "-endian", "MSB", "gray:out.raw"];
    let stdout = "", stderr = "";
    const commandResult = mode === "command" ? await createMagickCommand().execute({
     command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
     stdin: (async function* () {})(), signal: new AbortController().signal,
     stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
     stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    }) : undefined;
    const result = commandResult ? { exitCode: commandResult.exitCode, stdout, stderr }
     : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n").slice(1).map(row => Number(row.trim().split(":")[0])))
     .toEqual(order === "decreasing" ? decreasing : increasing);
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(raster);
   });
  }
 }
}
