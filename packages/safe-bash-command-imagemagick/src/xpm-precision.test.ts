import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    ["rgb(50%,25%,75%)", "80004000bfffffff"],
    ["gray(50%)", "800080008000ffff"],
    ["srgb(1,2,3)", "010102020303ffff"],
    ["rgb(1 2 3)", "010102020303ffff"],
    ["rgb(1,2,3)", "010102020303ffff"],
    ["RGB(1 2 3)", "010102020303ffff"],
    ["rgb(1.5,2,3)", "018202020303ffff"],
    ["rgba(1,2,3,0.5)", "010102020303ffff"],
    ["graya(50%,0.5)", "800080008000ffff"],
    ["#123456789abc", "123456789abcffff"],
    ["#12345a789", "123145a47897ffff"],
    ["#123456", "121234345656ffff"],
    ["#123", "111122223333ffff"],
    ["rgb(10.5,20.5,30.5)", "0a8b14951e9fffff"],
    ["rgba(10,20,30,0.5)", "0a0a14141e1effff"]
  ])(`preserves XPM palette precision in 16-bit RGBA (${mode}, %s)`, async (color, expected) => {
    const input = new TextEncoder().encode(`/* XPM */\nstatic char *tile[] = {"1 1 1 1", "A c ${color}", "A"};`);
    const files = new Map([["/tile.xpm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xpm", input);
    const args = ["/tile.xpm", "-depth", "16", "-endian", "MSB", "rgba:/pixel.raw"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it(`preserves functional XPM alpha when None enables transparency (${mode})`, async () => {
    const input = new TextEncoder().encode('/* XPM */\nstatic char *tile[] = {"2 1 2 1", "A c rgba(10,20,30,0.5)", "B c None", "AB"};');
    const files = new Map([["/tile.xpm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xpm", input);
    const args = ["/tile.xpm", "-depth", "16", "-endian", "MSB", "rgba:/pixel.raw"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe("0a0a14141e1e80000000000000000000");
  });
}
