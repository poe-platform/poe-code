import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independent ImageMagick 7.1.2-35 Q16-HDRI enumerations from the PPM pixels
// 208040ff2200: magick in.ppm [-alpha set -channel A -evaluate set 25% +channel]
// -colorspace <HSL|sRGB> -depth <8|16> txt:-. Expected bytes come from reading
// that exact TXT with -colorspace sRGB -depth <8|16> -endian MSB <rgb|rgba>:-.
const fixtures = [
  {
    space: "HSL", depth: 8, format: "rgb", hex: "208040ff2501",
    text: `# ImageMagick pixel enumeration: 2,1,0,255,hsl
0,0: (99,153,80)  #639950  hsl(139.765,60%,31.3725%)
1,0: (6,255,128)  #06FF80  hsl(8.47059,100%,50.1961%)
`
  },
  {
    space: "HSL", depth: 16, format: "rgba", hex: "2020808040404000ffff222100014000",
    text: `# ImageMagick pixel enumeration: 2,1,0,65535,hsla
0,0: (25486,39321,20560,16384)  #638E999950504000  hsla(140,60%,31.3725%,0.250004)
1,0: (1456,65535,32768,16384)  #05B0FFFF80004000  hsla(8,100%,50%,0.250004)
`
  },
  {
    space: "sRGB", depth: 8, format: "rgb", hex: "208040ff2200",
    text: `# ImageMagick pixel enumeration: 2,1,0,255,srgb
0,0: (32,128,64)  #208040  srgb(32,128,64)
1,0: (255,34,0)  #FF2200  srgb(255,34,0)
`
  }
];

for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const prefix of ["", "txt:"]) {
    it.each(fixtures)(`decodes native $space TXT depth=$depth through ${mode} (${prefix || "signature"})`, async fixture => {
      const bytes = new TextEncoder().encode(fixture.text);
      const files = new Map([["/native.dat", bytes]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/native.dat", bytes);
      const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
      const args = [prefix + "/native.dat", "-colorspace", "sRGB", "-depth", String(fixture.depth), "-endian", "MSB", `${fixture.format}:/out`];
      const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
      expect(Buffer.from(output).toString("hex")).toBe(fixture.hex);
      const identify = [prefix + "/native.dat", "-format", "%[colorspace]", "info:"];
      const metadata = mode === "sync" ? runConvertCliSync(identify, files) : await runConvertCli(identify, input);
      expect(metadata).toMatchObject({ exitCode: 0, stderr: "", stdout: fixture.space });
    });
  }
}
