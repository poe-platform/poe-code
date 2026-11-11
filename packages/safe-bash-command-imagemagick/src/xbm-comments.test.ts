import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const prefix of ["", "xbm:"]) for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    ["long block comment", `/* ${"bitmap ".repeat(1000)}*/\n#define cur_width 8`],
    ["line comment", "// icon\n#define cur_width 8"],
    ["mixed comments", "// icon\r\n/* bitmap */\n// tile\n#define cur_width 8"],
    ["leading comment", "/* hand drawn */\n#define cur_width 8"],
    ["tab", "#define\tcur_width 8"],
    ["preprocessor whitespace", " \t# \tdefine\tcur_width 8"],
    ["comment tokens", "/* #define short { */\n#define cur_width 8"]
  ])(`reads XBM with %s (${mode}, ${prefix})`, async (_label, header) => {
    const input = new TextEncoder().encode(`${header}\n#define cur_height 2\nstatic char cur_bits[] = { 0x01, 0x80 };`);
    const files = new Map([["/in.xbm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.xbm", input);
    const args = [`${prefix}/in.xbm`, "-depth", "8", "gray:/out.raw"];
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
    expect([...output]).toEqual([0, ...Array<number>(14).fill(255), 0]);
  });
}
