import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Raw bytes from ImageMagick 7.1.2-35 Q16-HDRI, with -endian MSB.
const cases = [
  { maximum: 255, space: "srgb", values: "50%,0,0", depth: 8, output: "rgb", hex: "7f0000" },
  { maximum: 255, space: "srgb", values: "100%,0%,0", depth: 8, output: "rgb", hex: "ff0000" },
  { maximum: 255, space: "srgb", values: "127,0,0", depth: 8, output: "rgb", hex: "7f0000" },
  { maximum: 255, space: "srgba", values: "12.5%,127,100%,50%", depth: 8, output: "rgba", hex: "1f7fff7f" },
  { maximum: 65535, space: "srgba", values: "12.5%,32767,100%,50%", depth: 16, output: "rgba", hex: "1fff7fffffff7fff" },
  { maximum: 255, space: "graya", values: "50%,25%", depth: 8, output: "rgba", hex: "7f7f7f3f" },
  { maximum: 65535, space: "graya", values: "50%,25%", depth: 16, output: "rgba", hex: "7fff7fff7fff3fff" }
];

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each(cases)(`reads TXT percentage components through ${mode}: $maximum $space ($values)`, async ({ maximum, space, values, depth, output, hex }) => {
    const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,${maximum},${space}\n0,0: (${values})\n`);
    const files = new Map([["/in.txt", bytes]]), filesystem = new MemoryFileSystem();
    if (mode === "retained") await filesystem.writeFile("/in.txt", bytes);
    const args = ["/in.txt", "-depth", String(depth), "-endian", "MSB", `${output}:/pix.raw`];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const pixels = mode === "retained" ? await filesystem.readFile("/pix.raw") as Uint8Array : files.get("/pix.raw")!;
    expect(Buffer.from(pixels).toString("hex")).toBe(hex);
  });
}
