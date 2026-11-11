import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const cycles of [[], [1], [1, 1], [-1], [5]]) {
    it(`preserves duplicate and unused XPM palette entries (${mode}, ${cycles})`, async () => {
      const input = new TextEncoder().encode('/* XPM */\nstatic char *tile[] = {"5 1 5 1","A c red","B c blue","C c red","D c green","E c magenta","CABAC"};');
      const files = new Map([["/tile.xpm", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/tile.xpm", input);
      const args = ["/tile.xpm", ...cycles.flatMap(n => ["-cycle", String(n)]), "-format", "%r", "-write", "info:/class", "-depth", "8", "rgba:/out"];
      expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
      const classification = mode === "retained" ? await filesystem.readFile("/class") : files.get("/class")!;
      const palette = ["ff0000ff", "0000ffff", "ff0000ff", "00ff00ff", "ff00ffff"];
      const shift = cycles.reduce((a, b) => a + b, 0);
      expect(Buffer.from(output).toString("hex")).toBe([2, 0, 1, 0, 2].map(i => palette[(i + shift + 5) % 5]).join(""));
      expect(new TextDecoder().decode(classification)).toBe("PseudoClass sRGB ");
    });
  }
}
