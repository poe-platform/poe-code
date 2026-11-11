import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    ["#11223380", "111122223333ffff"],
    ["#11223300", "111122223333ffff"],
    ["#112233ff", "111122223333ffff"],
    ["#1234", "111122223333ffff"],
    ["#1230", "111122223333ffff"],
    ["#123456789abcdef0", "123456789abcffff"],
    ["#123456789ABC0000", "123456789abcffff"],
    ["#123456789abc", "123456789abcffff"],
    ["#112233", "111122223333ffff"],
    ["None", "0000000000000000"]
  ])(`reads XPM hex colors as opaque RGB (${mode}, %s)`, async (color, expected) => {
    const input = new TextEncoder().encode(`/* XPM */\nstatic char *tile[] = {"1 1 1 1", "A c ${color}", "A"};`);
    const files = new Map([["/tile.xpm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xpm", input);
    const args = ["/tile.xpm", "-depth", "16", "-endian", "MSB", "rgba:/pixel.raw"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}
