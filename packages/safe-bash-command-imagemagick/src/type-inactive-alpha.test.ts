import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains the type suffix independently of opacity.
for (const [color, type] of [["#12345680", "Palette"], ["#88888880", "Grayscale"]]) {
  for (const palette of type === "Palette" ? [false, true] : [false]) {
    it.each(["deactivate", "discrete", "off", "active"])(`${color}, palette=${palette}: reports type with alpha %s`, async mode => {
      const fs = new MemoryFileSystem();
      const argumentValues = createCommandArguments([
        `xc:${color}`, ...(palette ? ["-colors", "4"] : []),
        ...(mode === "active" ? [] : ["-alpha", mode]),
        "-format", "%[type]|%[channels]|%[opaque]", "info:out"
      ]);
      let stdout = "", stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe(
        `${type}${mode === "off" ? "" : "Alpha"}|${mode === "off" ? "srgb " : "srgba"} ${(mode === "off" ? 3 : 4) + Number(palette)}.0|${mode === "active" ? "False" : "True"}`
      );
    });
  }
}
