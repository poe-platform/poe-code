import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    ["#123456789abc", "123456789abcffff"],
    ["#12345a789", "123145a47897ffff"],
    ["#123456", "121234345656ffff"],
    ["#123", "111122223333ffff"]
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
