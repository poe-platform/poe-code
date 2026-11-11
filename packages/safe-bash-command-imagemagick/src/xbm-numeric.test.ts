import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: magick tile.xbm -depth 8 gray:-.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    ["0x81, 0x01, 0x02, 0x00", "00ffffffffffff0000ff00ffffffffffffff"],
    ["129, 1, 2, 0", "00ffff00ff00ffff00ff00ffffffffffffff"],
    ["0201, 01, 02, 00", "00ffffffffffffff00ff00ffffffffffffff"]
  ])(`reads XBM numeric tokens as hexadecimal (${mode}, %s)`, async (values, expected) => {
    const input = new TextEncoder().encode(`#define tile_width 9\n#define tile_height 2\nstatic unsigned char tile_bits[] = { ${values} };`);
    const files = new Map([["/tile.xbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xbm", input);
    const args = ["/tile.xbm", "-depth", "8", "gray:/out.raw"];
    if (mode === "command") {
      const arguments_ = createCommandArguments(["/tile.xbm", "-depth", "8", "gray:-"]);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    } else {
      expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const output = mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
      expect(Buffer.from(output).toString("hex")).toBe(expected);
    }
  });
}
