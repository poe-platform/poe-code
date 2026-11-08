import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI adds 0.5 then truncates bitwise masks toward zero.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const operation of ["And", "Or", "Xor"] as const) {
    it.each(["-1", "-32768", "-100%", "0", "32768"])(`${mode}: ${operation} mask %s matches native`, async (operand) => {
      const values = [0, 1, 32, 64, 127, 128, 192, 254, 255];
      const bytes = await sharp(new Uint8Array(values.flatMap(value => [value, value, value, 255])), {
        raw: { width: values.length, height: 1, channels: 4 },
      }).png().toBuffer();
      const files = new Map([["/in.png", bytes]]);
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.png", bytes);
      const args = ["/in.png", "-channel", "RGB", "-evaluate", operation, operand, "/out.png"];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
      const expected = operand === "32768"
        ? operation === "And" ? [0, 0, 0, 0, 0, 128, 128, 128, 128]
          : operation === "Or" ? [128, 129, 160, 192, 255, 128, 192, 254, 255]
            : [128, 129, 160, 192, 255, 0, 64, 126, 127]
        : operand === "-32768" ? operation === "And" ? [0, 0, 0, 0, 0, 128, 128, 128, 128] : values.map(() => 0)
          : operand === "-100%" || operation === "And" ? values.map(() => 0) : values;
      expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
  }
}
