import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it(`decodes literal tab palette separators (${mode})`, async () => {
    const input = new TextEncoder().encode('/* XPM */\nstatic char *tile[] = {"1 1 1 1", "A\tc red", "A"};');
    const files = new Map([["/tile.xpm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xpm", input);
    const args = ["/tile.xpm", "-depth", "16", "-endian", "MSB", "rgba:/pixel.raw"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(output).toEqual(Uint8Array.from([255, 255, 0, 0, 0, 0, 255, 255]));
  });

  it.each([1, 2])(`decodes transparent XPM symbols (${mode}, cpp=%s)`, async cpp => {
    const width = cpp === 1 ? 13 : 20, height = cpp === 1 ? 5 : 15;
    const symbols = [" ".repeat(cpp), "r".repeat(cpp), "b".repeat(cpp)];
    const pixels = new Uint8Array(width * height * 4);
    const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
      const color = x < 3 && y < 4 ? 1 : x === width - 1 && y === height - 1 ? 2 : 0;
      pixels.set(color === 1 ? [255, 0, 0, 255] : color === 2 ? [0, 0, 255, 255] : [0, 0, 0, 0], (y * width + x) * 4);
      return symbols[color];
    }).join(""));
    const lines = [`${width} ${height} 3 ${cpp}`, `${symbols[0]} c None`, `${symbols[1]} c red`, `${symbols[2]} c #00000000FFFF`, ...rows];
    const input = new TextEncoder().encode(`/* XPM */\nstatic char *icon[] = {\n${lines.map(line => JSON.stringify(line)).join(",\n")}\n};`);
    const files = new Map([["/icon.xpm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/icon.xpm", input);
    const args = ["/icon.xpm", "/out.png"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect(decodeImage(output)).toMatchObject({ width, height, data: pixels });
  });
}
