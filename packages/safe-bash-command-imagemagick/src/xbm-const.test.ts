import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 rejects the const declaration with no output.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(["", "const "])(`matches native XBM declaration acceptance (${mode}, %s)`, async qualifier => {
    const input = new TextEncoder().encode(`#define tile_width 9\n#define tile_height 2\nstatic ${qualifier}unsigned char tile_bits[] = { 0x81, 0x01, 0x02, 0x00 };`);
    const files = new Map([["/tile.xbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.xbm", input);
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
      expect(result.exitCode).toBe(qualifier ? 1 : 0);
      expect(Buffer.concat(stdout).toString("hex")).toBe(qualifier ? "" : "00ffffffffffff0000ff00ffffffffffffff");
      if (qualifier) expect(stderr).toContain("improper image header");
      else expect(stderr).toBe("");
    } else {
      const args = ["/tile.xbm", "-depth", "8", "gray:/out.raw"];
      const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(qualifier ? 1 : 0);
      expect(result.stdout).toBe("");
      if (qualifier) {
        expect(result.stderr).toContain("improper image header");
        if (mode === "retained") await expect(filesystem.readFile("/out.raw")).rejects.toMatchObject({ code: "ENOENT" });
        else expect(files.has("/out.raw")).toBe(false);
      } else {
        expect(result.stderr).toBe("");
        const output = mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe("00ffffffffffff0000ff00ffffffffffffff");
      }
    }
  });
}
