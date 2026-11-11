import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it(`decodes native XPM palette names to RGBA16 (${mode})`, async () => {
    // Native ImageMagick 7.1.2-35: -depth 16 -endian MSB rgba:-.
    const colors = ["green", "gray", "grey50", "Light Goldenrod Yellow", "navy blue", "maroon", "purple", "red", "None"];
    const lines = [`${colors.length} 1 ${colors.length} 1`, ...colors.map((color, i) => `${i} c ${color}`), "012345678"];
    const input = new TextEncoder().encode(`/* XPM */\nstatic char *x[]={${lines.map(line => JSON.stringify(line)).join(",")}};`);
    const files = new Map([["/tile.xpm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xpm", input);
    const args = ["/tile.xpm", "-depth", "16", "-endian", "MSB", "rgba:/pixel.raw"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(
      "0000ffff0000ffffbebebebebebeffff7f7f7f7f7f7ffffffafafafad2d2ffff000000008080ffffb0b030306060ffffa0a02020f0f0ffffffff00000000ffff0000000000000000"
    );
  });
}
