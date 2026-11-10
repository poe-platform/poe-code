import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runIdentifyCli, runMagickCli } from "./index.js";

// Expected values from ImageMagick 7 using the same PNG bytes.
const cases = [
  { name: "translucent RGBA", channels: 4, width: 2, pixels: [200, 100, 50, 255, 20, 30, 40, 128, 0, 0, 0, 255, 255, 255, 255, 0], expected: "29603.2|30726.7|0|65535|0.465686|0.50128", alpha: "|0.62549|0.478544" },
  { name: "opaque RGBA", channels: 4, width: 1, pixels: [200, 100, 51, 255], expected: "38935.5|0|13107|65535|0.784314|0", alpha: "|1|0" },
  { name: "RGB", channels: 3, width: 2, pixels: [200, 100, 50, 20, 30, 40, 0, 0, 0, 255, 255, 255], expected: "25807.1|30515.1|0|65535|0.465686|0.50128", alpha: "" }
] as const;

for (const route of ["command", "buffered", "retained", "info"] as const) {
  it.each(cases)(`${route}: matches native overall and channel statistics for $name`, async ({ channels, width, pixels, expected, alpha }) => {
    const bytes = await sharp(new Uint8Array(pixels), { raw: { width, height: pixels.length / width / channels, channels } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const format = "%[mean]|%[standard-deviation]|%[min]|%[max]|%[fx:mean.r]|%[fx:standard_deviation.r]" + (alpha ? "|%[fx:mean.a]|%[fx:standard_deviation.a]" : "");
    const args = ["-format", format, "/input.png"];
    if (route === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const result = await createIdentifyCommand().execute({ command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
      expect(result).toEqual({ exitCode: 0 });
      expect(stderr).toBe("");
      expect(stdout).toBe(expected + alpha);
    } else {
      const input = route === "buffered" ? new Map([["/input.png", bytes]]) : { filesystem: fs, cwd: "/" };
      const result = route === "info" ? await runMagickCli(["/input.png", "-format", format, "info:"], input) : await runIdentifyCli(args, input);
      expect(result).toEqual({ exitCode: 0, stdout: expected + alpha, stderr: "" });
    }
  });
}
