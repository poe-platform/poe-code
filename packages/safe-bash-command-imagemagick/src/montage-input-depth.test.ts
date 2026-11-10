import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// The first three cases reproduce complete P6 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["-depth", "16", "rgb:one", "-depth", "8"], width: 1, maxval: 255, hex: "3478bc" },
    { inputs: ["-depth", "8", "rgb:one", "-depth", "16"], width: 2, maxval: 65535, hex: "12123434565678789a9abcbc" },
    { inputs: ["-depth", "8", "rgb:one"], width: 2, maxval: 255, hex: "123456789abc" },
    { inputs: ["rgb:one", "-depth", "8"], width: 1, maxval: 255, hex: "3478bc" },
    { inputs: ["-depth", "8", "+depth", "rgb:one", "-depth", "8"], width: 1, maxval: 255, hex: "3478bc" },
    { inputs: ["-depth", "8", "rgb:one", "+depth"], width: 2, maxval: 65535, hex: "12123434565678789a9abcbc" },
    { inputs: ["-depth", "16", "rgb:one", "-depth", "8", "rgb:one"], width: 3, maxval: 255, hex: "3478bc123456789abc" },
    { inputs: ["-depth", "16", "rgb:one", "-depth", "8", "rgb:one", "-reverse"], width: 3, maxval: 255, hex: "123456789abc3478bc" },
    { inputs: ["-depth", "16", "rgb:one", "-depth", "8", "+clone"], width: 2, maxval: 255, hex: "3478bc3478bc" },
  ])(`${mode}: preserves input depth independently of output depth: $inputs`, async ({ inputs, width, maxval, hex }) => {
    const bytes = Buffer.from("123456789abc", "hex");
    const args = ["-geometry", "+0+0", "-tile", "x1", "-size", "1x1", ...inputs, "ppm:-"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/one", bytes);
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect(stderr).toBe("");
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const files = new Map([["one", bytes]]);
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output)).toEqual(Buffer.concat([
      Buffer.from(`P6\n${width} 1\n${maxval}\n`), Buffer.from(hex, "hex")
    ]));
  });
}
