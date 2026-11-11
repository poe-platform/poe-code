import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P2\n5 4\n255\n0 0 0 0 255\n0 80 0 255 0\n0 0 80 0 0\n140 140 140 0 220\n");
for (const mode of ["public", "sync"] as const) {
 for (const [selector, ids, hex] of [
  ["keep", [0, 1], "00000000000000000001000000000000000000000000000000000000000000000000000000000000"],
  ["remove", [0, 4, 6, 2, 3, 5, 7], "00000000000000000000000000020000000300040000000000050004000400060006000600040007"],
 ] as const) for (const alias of [selector, `${selector}-ids`]) for (const reset of [false, true]) {
  it(`selects component ${alias}, reset=${reset} (${mode})`, async () => {
   const files = new Map([["in.pgm", input], ["out.raw", new TextEncoder().encode("KEEP")]]);
   const fs = new MemoryFileSystem();
   for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
   const args = ["in.pgm", "-define", "connected-components:verbose=true", "-define", `connected-components:${alias}=1`, ...(reset ? ["+define", `connected-components:${alias}`] : []), "-connected-components", "4", "-depth", "16", "-endian", "MSB", "gray:out.raw"];
   const argumentValues = createCommandArguments(args);
   let stdout = "", stderr = "";
   const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   });
   if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
   if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
   expect(result.exitCode).toBe(0);
   expect(stderr).toBe("");
   expect(stdout.trim().split("\n").slice(1).map(line => Number(line.trim().split(":")[0]))).toEqual(reset ? [0, 4, 6, 1, 2, 3, 5, 7] : ids);
   const bytes = mode === "sync" ? files.get("out.raw")! : await fs.readFile("/out.raw");
   expect(Buffer.from(bytes).toString("hex")).toBe(reset ? "00000000000000000001000000020000000300040000000000050004000400060006000600040007" : hex);
  });
 }
}
