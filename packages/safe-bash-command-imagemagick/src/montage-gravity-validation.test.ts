import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
it.each([
  { gravity: "sideways", top: undefined },
  { gravity: "", top: undefined },
  { gravity: "Centre", top: undefined },
  { gravity: "North-West", top: undefined },
  { gravity: "Undefined", top: 0 },
  { gravity: "None", top: 0 },
  { gravity: "Forget", top: 0 },
  { gravity: "NorthWest", top: 0 },
  { gravity: "North", top: 0 },
  { gravity: "NorthEast", top: 0 },
  { gravity: "West", top: 1 },
  { gravity: "Center", top: 1 },
  { gravity: "East", top: 1 },
  { gravity: "SouthWest", top: 2 },
  { gravity: "South", top: 2 },
  { gravity: "SouthEast", top: 2 },
  { gravity: "sOuThEaSt", top: 2 },
])(`${mode}: validates montage gravity $gravity before writing output`, async ({ gravity, top }) => {
  for (const output of top === undefined ? ["png:-", "sheet.png", "existing.png"] : ["png:-"]) {
    const fs = new MemoryFileSystem();
    const original = new TextEncoder().encode("preserve this destination");
    await fs.writeFile("/existing.png", original);
    const input = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 255 0 0\n");
    await fs.writeFile("/input.ppm", input);
    const files = new Map([["existing.png", original], ["input.ppm", input]]);
    const args = ["-geometry", "3x3+0+0", "-tile", "1x1", "-gravity", gravity, "input.ppm", output];
    let bytes: Uint8Array | undefined, stderr = "", stdout = "", exitCode: number;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const context: CommandContext = {
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }, registerCleanup() {}
      };
      exitCode = (await command.execute(context)).exitCode;
      bytes = new Uint8Array(chunks.flatMap(chunk => Array.from(chunk)));
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      ({ exitCode, stderr, stdout, stdoutBytes: bytes } = result);
    }
    if (top === undefined) {
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`unrecognized gravity type '${gravity}'`);
      expect(stdout).toBe("");
      expect(bytes?.length ?? 0).toBe(0);
      expect(files.has("sheet.png")).toBe(false);
      expect(files.get("existing.png")).toEqual(original);
      expect(await fs.readdir("/")).toEqual([{ name: "existing.png", type: "file" }, { name: "input.ppm", type: "file" }]);
      expect(await fs.readFile("/existing.png")).toEqual(original);
    } else {
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      const image = decodeImage(bytes!);
      expect([image.width, image.height]).toEqual([3, 3]);
      const expected = new Uint8Array(3 * 3 * 4).fill(255);
      for (let x = 0; x < 3; x++) expected.set([255, 0, 0, 255], (top * 3 + x) * 4);
      expect(Array.from(image.data)).toEqual(Array.from(expected));
    }
  }
});
