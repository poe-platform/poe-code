import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(["none", "leading", "initializer"])(`matches native XBM comment acceptance (${mode}, %s)`, async comment => {
    const input = new TextEncoder().encode(`${comment === "leading" ? "/* bitmap */\n" : ""}#define tile_width 9\n#define tile_height 2\nstatic unsigned char tile_bits[] = {\n 0x81, 0x01,${comment === "initializer" ? " /* row two */" : ""} 0x02, 0x00 };`);
    const files = new Map([["/tile.xbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xbm", input);
    const args = ["/tile.xbm", "-depth", "8", "gray:-"];
    let exitCode: number, stdout = "", stderr = "";
    if (mode === "command") {
      const arguments_ = createCommandArguments(args);
      const result = await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      exitCode = result.exitCode;
    } else {
      const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      exitCode = result.exitCode;
      stderr = result.stderr;
      expect(result.stdout).toBe("");
      stdout = Buffer.from(result.stdoutBytes ?? []).toString("hex");
    }
    expect(exitCode).toBe(comment === "initializer" ? 1 : 0);
    expect(stdout).toBe(comment === "initializer" ? "" : "00ffffffffffff0000ff00ffffffffffffff");
    if (comment === "initializer") expect(stderr).toContain("improper image header");
    else expect(stderr).toBe("");
  });

  it(`reads byte-padded XBM scanlines (${mode})`, async () => {
    const input = new TextEncoder().encode(`#define icon_width 13\n#define icon_height 5\nstatic unsigned char icon_bits[] = {\n0x07, 0x00, 0x07, 0x00, 0x07, 0x00, 0x07, 0x00, 0x00, 0x10 };`);
    const files = new Map([["/icon.xbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/icon.xbm", input);
    const args = ["/icon.xbm", "/out.png"];
    if (mode === "command") {
      const arguments_ = createCommandArguments(args);
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode).toBe(0);
      expect(stderr).toBe("");
    } else {
      expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([13, 5]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 13; x++) {
      const value = (x < 3 && y < 4) || (x === 12 && y === 4) ? 0 : 255;
      expect([...output.data.subarray((y * 13 + x) * 4, (y * 13 + x + 1) * 4)]).toEqual([value, value, value, 255]);
    }
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each(["2", ""])(`matches native XBM array declaration acceptance (${mode}, [%s])`, async size => {
    const input = new TextEncoder().encode(`#define cur_width 8\n#define cur_height 2\nstatic char cur_bits[${size}] = { 0x01, 0x80 };`);
    const files = new Map([["/in.xbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.xbm", input);
    const args = ["/in.xbm", "-depth", "8", "gray:/out.raw"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(size ? 1 : 0);
    if (size) {
      expect(result.stderr).toContain("XBM");
      if (mode === "retained") await expect(filesystem.readFile("/out.raw")).rejects.toMatchObject({ code: "ENOENT" });
      else expect(files.has("/out.raw")).toBe(false);
    } else {
      expect(result.stderr).toBe("");
      const output = mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
      expect(Buffer.from(output).toString("hex")).toBe("00ffffffffffffffffffffffffffff00");
    }
  });
}
