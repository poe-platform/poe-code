import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independently generated with ImageMagick 7.1.2-31 Q16-HDRI from
// P6 2x1 pixels 208040ff2200, using -colorspace LinearGray txt:-.
const fixtures = [
  { space: "lineargray", maximum: 255, pixels: "0,0: (41)  #292929  lineargray(16.1147%)\n1,0: (57)  #393939  lineargray(22.4096%)\n", hex: "707070ff828282ff" },
  { space: "lineargraya", maximum: 255, pixels: "0,0: (41,128)  #29292980  lineargraya(16.1147%,0.500008)\n1,0: (57,128)  #39393980  lineargraya(22.4096%,0.500008)\n", hex: "7070708082828280" },
  { space: "lineargray", maximum: 65535, pixels: "0,0: (10561)  #294129412941  lineargray(16.1147%)\n1,0: (14686)  #395E395E395E  lineargray(22.4096%)\n", hex: "707070ff828282ff" },
  { space: "srgb", maximum: 255, pixels: "0,0: (32,128,64)  #208040  srgb(32,128,64)\n1,0: (255,34,0)  #FF2200  srgb(255,34,0)\n", hex: "208040ffff2200ff" },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const { space, maximum, pixels, hex } of fixtures) {
    it(`decodes native ${space} TXT at maximum ${maximum} through ${mode}`, async () => {
      const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 2,1,0,${maximum},${space}\n${pixels}`);
      const files = new Map([["/in.txt", bytes]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.txt", bytes);
      const args = ["/in.txt", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
      const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const output = mode === "retained" ? await filesystem.readFile("/out") as Uint8Array : files.get("/out")!;
      expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
  }
}
