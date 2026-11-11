import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const rle of [false, true]) {
    for (const write of [false, true]) {
      for (const compression of [undefined, "None", "RLE"]) {
        it(`preserves TGA compression and pixels (${mode}, rle=${rle}, override=${compression}, write=${write})`, async () => {
          // Independent 24-bit truecolor fixture: RGB (10,20,30), (90,110,130).
          const header = new Uint8Array(18);
          header[2] = rle ? 10 : 2; header[12] = 2; header[14] = 1; header[16] = 24;
          const bytes = Uint8Array.from([...header, ...(rle ? [1] : []), 30, 20, 10, 130, 110, 90]);
          const files = new Map([["/in.tga", bytes]]), fs = new MemoryFileSystem();
          await fs.writeFile("/in.tga", bytes);
          const args = ["/in.tga", ...(compression ? ["-compress", compression] : []),
            ...(write ? ["-write", "/out.tga", "-format", "%C|%[compression]", "info:"] : ["/out.tga"])];
          let stdout = "", stderr = "";
          const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
          }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
          expect(result.exitCode).toBe(0);
          const expected = compression ?? (rle ? "RLE" : "None");
          expect(mode === "command" ? stdout : "stdout" in result ? result.stdout : undefined).toBe(write ? `${expected}|${expected}` : "");
          expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : undefined).toBe("");
          const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.tga") : files.get("/out.tga")!;
          expect(output[2]).toBe(expected === "RLE" ? 10 : 2);
          expect(decodeImage(output).data).toEqual(Uint8Array.from([10, 20, 30, 255, 90, 110, 130, 255]));
        });
      }
    }
  }
}
