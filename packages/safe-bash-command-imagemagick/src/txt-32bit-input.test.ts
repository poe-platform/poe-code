import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI with identical TXT bytes and arguments.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
  it.each([
    { maximum: 4294967295, space: "srgb", values: "1,0,0", format: "%z/%[fx:p{0,0}.r]", stdout: "32/2.32830643654e-10" },
    { maximum: 65535, space: "srgb", values: "1,0,0", format: "%z/%[fx:p{0,0}.r]", stdout: "16/1.52590218967e-05" },
    { maximum: 255, space: "srgb", values: "1,0,0", format: "%z/%[fx:p{0,0}.r]", stdout: "8/0.00392156862745" },
    { maximum: 4294967295, space: "srgba", values: "4294967295,0,0,1", format: "%z/%[fx:p{0,0}.r]/%[fx:p{0,0}.a]", stdout: "32/1/2.32830643654e-10" },
  ])(`reads $maximum TXT sample ranges via ${mode}: $space`, async ({ maximum, space, values, format, stdout }) => {
    const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,${maximum},${space}\n0,0: (${values})\n`);
    const files = new Map([["/in.txt", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.txt", bytes);
    const args = ["/in.txt", "-precision", "12", "-format", format, "info:"];
    let result;
    if (mode === "command") {
      let output = "", errors = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { errors += new TextDecoder().decode(chunk); } },
      });
      result = { ...status, stdout: output, stderr: errors };
    } else result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout });
  });
}
