import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import fixtures from "../../../tests/fixtures/media/webp-fixtures.json" with { type: "json" };
import { runConvertCli } from "./index.js";

for (const fixture of fixtures) {
  for (const mode of ["buffered", "retained"] as const) {
    it(`converts native ${fixture.name} WebP to PNG with exact RGBA pixels (${mode})`, async () => {
      const input = new Uint8Array(Buffer.from(fixture.webp, "base64"));
      const files = new Map([["/input.webp", input]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.webp", input);
      const result = await runConvertCli(["/input.webp", "/output.png"],
        mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
      const decoded = decodeImage(output);
      expect([decoded.width, decoded.height]).toEqual([64, 48]);
      expect(decoded.data).toEqual(new Uint8Array(Buffer.from(fixture.rgba, "base64")));
    });
  }
}
