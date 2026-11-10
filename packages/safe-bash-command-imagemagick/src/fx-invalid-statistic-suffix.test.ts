import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  for (const identify of [false, true]) {
    it(`rejects suffixed FX entropy (retained=${retained}, identify=${identify})`, async () => {
      for (const pixels of [
        [255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0],
        [0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]
      ]) {
        const bytes = await sharp(Uint8Array.from(pixels), { raw: { width: 5, height: 1, channels: 3 } }).png().toBuffer();
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        for (const format of ["w=%w;%[fx:entropy.r];h=%h", "%[fx:entropy.r]", "%[fx:entropy.r]|%[fx:entropy.r]|%[fx:entropy.r]", "%[fx:mean.r]|%[entropy]\n"]) {
          const argv = identify
            ? ["identify", "-format", format, "/input.png"]
            : ["/input.png", "-format", format, "info:"];
          let result;
          if (retained) {
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const commandResult = await createMagickCommand().execute({
              command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
              signal: new AbortController().signal, stdin: (async function* () {})(),
              stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
              stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            result = { exitCode: commandResult.exitCode, stdout, stderr };
          } else {
            result = await runMagickCli(argv, new Map([["/input.png", bytes]]));
          }
          if (format === "%[fx:mean.r]|%[entropy]\n") {
            expect(result).toEqual({ exitCode: 0, stdout: "0.6|0.804936\n", stderr: "" });
          } else {
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toBe(format.startsWith("w=") ? "w=5;;h=1" : format.includes("|") ? "||" : "");
            expect(result.stderr).not.toContain("improper image header");
            expect(result.stderr).toContain("Expected operator at '.r'");
          }
        }
      }
    });
  }
}
