import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const output of ["/out.xbm", "XBM:/out.bin"]) {
    for (const write of [false, true]) {
      it(`writes byte-padded XBM (${mode}, ${output}, write=${write})`, async () => {
        const data = new Uint8Array(13 * 5 * 4).fill(255);
        for (let y = 0; y < 5; y++) for (let x = 0; x < 13; x++) {
          if ((x < 3 && y < 4) || (x === 12 && y === 4)) data.set([0, 0, 0, 255], (y * 13 + x) * 4);
        }
        const input = encodeImage({ width: 13, height: 5, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72 }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...(write ? ["-write", output, "/final.png"] : [output])];
        let commandResult;
        if (mode === "command") {
          const arguments_ = createCommandArguments(args);
          let stderr = "";
          const result = await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
          });
          commandResult = { exitCode: result.exitCode, stdout: "", stderr };
        }
        const result = commandResult ?? (mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files));
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const path = output.startsWith("XBM:") ? output.slice(4) : output;
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile(path) : files.get(path)!;
        const text = new TextDecoder().decode(bytes);
        expect(text).toContain("_width 13\n");
        expect(text).toContain("_height 5\n");
        const values = text.slice(text.indexOf("{") + 1, text.indexOf("}")).split(",").map(value => value.trim()).filter(Boolean).map(Number);
        expect(values).toEqual([7, 0, 7, 0, 7, 0, 7, 0, 0, 16]);
      });
    }
  }
}

it.each([
  [["tile.xbm", "xbm:-"], "#define __width 9\n#define __height 2\nstatic char __bits[] = {\n  0x81, 0x01, 0x02, 0x00, };\n"],
  [["-size", "9x5", "gradient:black-white", "xbm:-"], "#define __width 9\n#define __height 5\nstatic char __bits[] = {\n  0xFF, "],
])("matches native XBM C text on command stdout (%s)", async (args, expected) => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/tile.xbm", new TextEncoder().encode("#define tile_width 9\n#define tile_height 2\nstatic unsigned char tile_bits[] = {\n 0x81, 0x01, 0x02, 0x00 };\n"));
  const arguments_ = createCommandArguments(args);
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  const text = Buffer.concat(stdout).toString();
  if (args[0] === "tile.xbm") expect(text).toBe(expected);
  else expect(text.startsWith(expected)).toBe(true);
});
