import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: magick tile.xbm -depth 8 gray:-.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(["width-first", "height-first"])(`matches XBM dimension order acceptance (${mode}, %s)`, async order => {
    const header = order === "width-first" ? "#define tile_width 9\n#define tile_height 2" : "#define tile_height 2\n#define tile_width 9";
    const input = new TextEncoder().encode(`${header}\nstatic unsigned char tile_bits[] = { 0x81, 0x01, 0x02, 0x00 };`);
    const files = new Map([["/tile.xbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xbm", input);
    const args = ["/tile.xbm", "-depth", "8", "gray:-"];
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const arguments_ = createCommandArguments(args);
    const result = mode === "command" ? {
      ...await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }), stdout: "", stdoutBytes: Buffer.concat(stdout), stderr
    } : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(order === "width-first" ? 0 : 1);
    expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(order === "width-first" ? "00ffffffffffff0000ff00ffffffffffffff" : "");
    if (order === "width-first") expect(result.stderr).toBe("");
    else expect(result.stderr).toContain("improper image header");
  });
}
