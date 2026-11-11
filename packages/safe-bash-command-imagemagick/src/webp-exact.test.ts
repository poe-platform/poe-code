import { expect, it } from "vitest";
import sharp, { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained"] as const) {
  for (const animated of [false, true]) for (const setting of ["true", "false", "default", "reset"] as const) {
    it(`honors webp:exact=${setting} without changing visible pixels (${mode}, animated=${animated})`, async () => {
      const input = new Uint8Array(64 * 48 * 4);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
        input.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256,
          (x * 9 + y * 11) % 256, x % 7 === 0 ? 0 : (x * 5 + y * 11) % 256], (y * 64 + x) * 4);
      }
      const png = await sharp(input, { raw: { width: 64, height: 48, channels: 4 } }).png().toBuffer();
      const files = new Map([["/input.png", png]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", png);
      const defines = setting === "default" ? [] : setting === "reset"
        ? ["-define", "webp:exact=true", "+define", "webp:exact"]
        : ["-define", `webp:exact=${setting}`];
      const result = await runConvertCli(["/input.png", ...(animated ? ["(", "/input.png", "-channel", "RGB", "-negate", "+channel", ")"] : []),
        "-define", "webp:lossless=true", ...defines, "-write", "/copy.webp", "/output.webp"],
      mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result, result.stderr).toMatchObject({ exitCode: 0 });
      for (const path of ["/copy.webp", "/output.webp"]) {
        const output = mode === "buffered" ? files.get(path)! : await fs.readFile(path);
        if (animated) expect(readImageMetadata(output).pages).toBe(2);
        for (const page of animated ? [0, 1] : [0]) {
          const { data } = decodeImage(output, { page });
          let hiddenChanges = 0;
          for (let i = 0; i < input.length; i += 4) {
            expect(data[i + 3]).toBe(input[i + 3]);
            if (input[i + 3] !== 0 || setting === "true") {
              expect(data.subarray(i, i + 3)).toEqual(input.subarray(i, i + 3).map(value => page === 1 ? 255 - value : value));
            } else if (data.subarray(i, i + 3).some((value, channel) => value !== input[i + channel])) hiddenChanges++;
          }
          if (setting !== "true") expect(hiddenChanges).toBeGreaterThan(0);
        }
      }
    });
  }
}
