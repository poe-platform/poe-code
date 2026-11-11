import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: in.txt -precision 12 -format '%z/%[fx:p{0,0}.r]' info:
for (const mode of ["buffered", "sync", "command"] as const) {
  it.each([
    [7, "3/0.1428571386"],
    [15, "4/0.0666666666667"],
    [100, "7/0.00787401572603"],
    [255, "8/0.00392156862745"],
    [256, "8/0.00392156862745"],
    [65535, "16/1.52590218967e-05"]
  ])(`reads TXT maximum %s with native depth and sample scaling (${mode})`, async (maximum, stdout) => {
    const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,${maximum},srgb\n0,0: (1,0,0)\n`);
    const files = new Map([["/in.txt", bytes]]);
    const args = ["/in.txt", "-precision", "12", "-format", "%z/%[fx:p{0,0}.r]", "info:"];
    let result;
    if (mode === "sync") result = runConvertCliSync(args, files);
    else if (mode === "buffered") result = await runConvertCli(args, files);
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.txt", bytes);
      const argumentValues = createCommandArguments(args);
      let output = "", errors = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout: output, stderr: errors };
    }
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout });
  });
}
