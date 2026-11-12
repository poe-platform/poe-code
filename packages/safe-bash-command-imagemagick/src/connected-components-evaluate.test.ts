import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
 for (const [name, adjustment, defines, expected] of [
  ["adjusted labels", ["-evaluate", "add", "10%"], [], "000000000000000100010001"],
  ["adjusted mean colors", ["-evaluate", "add", "10%"], ["-define", "connected-components:mean-color=true"], "30b157d872f3cf4f820242c3"],
  ["unadjusted labels", [], [], "000000000000000100010001"],
 ] as const) {
  it(`exports ${name} (${mode})`, async () => {
   const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
   const args = ["xc:#173e59", "xc:#b56829", "+append", ...adjustment, ...defines, "-connected-components", "4", "-depth", "16", "-endian", "MSB", "rgb:out.rgb"];
   let stderr = "";
   const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
   }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
   expect(result.exitCode).toBe(0);
   expect("stderr" in result ? result.stderr : stderr).toBe("");
   const bytes = mode === "buffered" || mode === "sync" ? files.get("out.rgb")! : await fs.readFile("/out.rgb");
   expect(Buffer.from(bytes).toString("hex")).toBe(expected);
  });
 }
}
