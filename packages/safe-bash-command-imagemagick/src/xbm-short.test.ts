import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const [width, words, blackPixels] of [
    [13, "0x1001, 0x0100", [0, 12, 21]],
    [8, "0xff01, 0xff80", [0, 15]],
    [17, "0x8001, 0xffff, 0x0100, 0xfffe", [0, 15, 16, 25]]
  ] as const) {
    it(`reads word-padded X10 XBM scanlines (${mode}, width=${width})`, async () => {
      const input = new TextEncoder().encode(`#define cur_width ${width}\n#define cur_height 2\nstatic short cur_bits[] = { ${words} };`);
      const files = new Map([["/cur.xbm", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/cur.xbm", input);
      const args = ["/cur.xbm", "-depth", "8", "gray:/out.raw"];
      if (mode === "command") {
        const arguments_ = createCommandArguments(args);
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      } else {
        expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
      expect([...output]).toEqual(Array.from({ length: width * 2 }, (_, index) => (blackPixels as readonly number[]).includes(index) ? 0 : 255));
    });
  }
}
