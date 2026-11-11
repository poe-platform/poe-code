import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independent ImageMagick 7.1.2-35 Q16-HDRI enumerations of RGB 208040ff2200,
// generated with -colorspace XYZ. Expected bytes come from reading that TXT
// with -colorspace sRGB -depth 8/16 -endian MSB rgb:/rgba:.
const fixtures = [
  {
    depth: 8, alpha: false, hex: "277f40ff2100",
    text: `# ImageMagick pixel enumeration: 2,1,0,255,xyz
0,0: (24,41,19)  #182913  xyz(9.23985,16.1149,7.47373)
1,0: (107,57,5)  #6B3905  xyz(41.8116,22.4026,2.12037)
`,
  },
  {
    depth: 16, alpha: false, hex: "201b8080403fffff220c0000",
    text: `# ImageMagick pixel enumeration: 2,1,0,65535,xyz
0,0: (6055,10561,4898)  #17A729411322  xyz(9.23985,16.1149,7.47373)
1,0: (27401,14682,1390)  #6B09395A056E  xyz(41.8116,22.4026,2.12037)
`,
  },
  {
    depth: 8, alpha: true, hex: "277f4080ff210040",
    text: `# ImageMagick pixel enumeration: 2,1,0,255,xyza
0,0: (24,41,19,128)  #18291380  xyza(9.23985,16.1149,7.47373,0.501961)
1,0: (107,57,5,64)  #6B390540  xyza(41.8116,22.4026,2.12037,0.25098)
`,
  },
  {
    depth: 16, alpha: true, hex: "201b8080403f8080ffff220c00004040",
    text: `# ImageMagick pixel enumeration: 2,1,0,65535,xyza
0,0: (6055,10561,4898,32896)  #17A7294113228080  xyza(9.23985,16.1149,7.47373,0.501961)
1,0: (27401,14682,1390,16448)  #6B09395A056E4040  xyza(41.8116,22.4026,2.12037,0.25098)
`,
  },
  {
    depth: 8, alpha: false, hex: "208040ff2200",
    text: `# ImageMagick pixel enumeration: 2,1,0,255,srgb
0,0: (32,128,64)  #208040  srgb(32,128,64)
1,0: (255,34,0)  #FF2200  srgb(255,34,0)
`,
  },
];

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each(fixtures)(`reads independently generated TXT via ${mode}: $depth-bit alpha=$alpha $hex`, async ({ text, depth, alpha, hex }) => {
    const bytes = new TextEncoder().encode(text);
    const files = new Map([["/native.txt", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/native.txt", bytes);
    const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
    const infoArgs = ["/native.txt", "-format", "%[colorspace]", "info:"];
    const info = mode === "sync" ? runConvertCliSync(infoArgs, files) : await runConvertCli(infoArgs, input);
    expect(info).toMatchObject({ exitCode: 0, stderr: "", stdout: text.includes(",xyz") ? "XYZ" : "sRGB" });
    const args = ["/native.txt", "-colorspace", "sRGB", "-depth", String(depth), "-endian", "MSB", `${alpha ? "rgba" : "rgb"}:/pixels`];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "" });
    const output = mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}
