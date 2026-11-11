import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.from("50350a3320320a3235350a112233445566", "hex"));

for (const mode of ["buffered", "sync", "retained", "command"]) {
  for (const beforeInput of [false, true]) {
    for (const setting of [["-set", "option:orient", "RightTop"], ["-orient", "RightTop"]]) {
      it.each([
        { operation: [], output: ["-format", "%wx%h:%[orientation]", "info:/out"], expected: "3x2:RightTop" },
        { operation: ["-auto-orient"], output: ["-format", "%wx%h:%[orientation]", "info:/out"], expected: "2x3:RightTop" },
        { operation: ["-auto-orient"], output: ["-depth", "8", "gray:/out"], expected: "441155226633" }
      ])(`${mode} beforeInput=${beforeInput} ${setting.join(" ")} $output after $operation`, async ({ operation, output, expected }) => {
        const files = new Map([["/in.pgm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.pgm", input);
        const args = [...(beforeInput ? [...setting, "/in.pgm"] : ["/in.pgm", ...setting]), ...operation, ...output];
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(bytes).toString(output.includes("gray:/out") ? "hex" : "utf8")).toBe(expected);
      });
    }
  }
}
