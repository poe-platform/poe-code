import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Raw bytes from ImageMagick 7.1.2-35 Q16-HDRI reading these exact TXT inputs
// with -depth <8|16> -endian MSB <rgb|rgba>:-.
const fixtures = [
  {
    name: "fractional red and integer control", maximum: 255, space: "srgb", format: "rgb",
    pixels: ["127,0,0", "127.1,0,0", "127.5,0,0", "127.9,0,0"],
    hex8: "7f00007f00007f00007f0000", hex16: "7f7f000000007f7f000000007f7f000000007f7f00000000"
  },
  {
    name: "color and alpha", maximum: 255, space: "srgba", format: "rgba",
    pixels: ["127.9,64.5,254.9,128.9"],
    hex8: "7f40fe80", hex16: "7f7f4040fefe8080"
  },
  {
    name: "gray and alpha", maximum: 255, space: "graya", format: "rgba",
    pixels: ["127.9,128.9"],
    hex8: "7f7f7f80", hex16: "7f7f7f7f7f7f8080"
  },
  {
    name: "16-bit color and alpha", maximum: 65535, space: "srgba", format: "rgba",
    pixels: ["32767.9,16448.5,65534.9,33023.9"],
    hex8: "7f40ff80", hex16: "7fff4040fffe80ff"
  }
];

for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const depth of [8, 16] as const) {
    it.each(fixtures)(`truncates TXT components before scaling: $name via ${mode}, depth=${depth}`, async fixture => {
      const text = `# ImageMagick pixel enumeration: ${fixture.pixels.length},1,0,${fixture.maximum},${fixture.space}\n` +
        fixture.pixels.map((pixel, x) => `${x},0: (${pixel})\n`).join("");
      const bytes = new TextEncoder().encode(text);
      const files = new Map([["/in.txt", bytes]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.txt", bytes);
      const args = ["/in.txt", "-depth", String(depth), "-endian", "MSB", `${fixture.format}:/pix.raw`];
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const output = mode === "retained" ? await filesystem.readFile("/pix.raw") : files.get("/pix.raw")!;
      expect(Buffer.from(output).toString("hex")).toBe(depth === 8 ? fixture.hex8 : fixture.hex16);
    });
  }
}
