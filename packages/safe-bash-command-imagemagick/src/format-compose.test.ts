import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Formatting observations from ImageMagick 7.1.2-35 Q16-HDRI.
describe.each(["command", "sync"] as const)("compose formatting (%s)", mode => {
  it.each([
    { options: ["xc:#2060b080"], expected: "Over" },
    { options: ["xc:#2060b080", "-compose", "Multiply"], expected: "Multiply" },
    { options: ["xc:#2060b080", "-compose", "multiply"], expected: "Multiply" },
    { options: ["xc:#2060b080", "-compose", "cOpY"], expected: "Copy" },
    { options: ["xc:#2060b080", "-compose", "COLORBURN"], expected: "ColorBurn" },
    { options: ["xc:#2060b080", "-compose", "sRcOvEr"], expected: "SrcOver" },
    { options: ["-compose", "multiply", "xc:#2060b080"], expected: "Multiply" },
    { options: ["xc:#2060b080", "-compose", "multiply", "-compose", "cOpY"], expected: "Copy" },
    { options: ["xc:#2060b080", "-compose", "multiply", "+compose"], expected: "Over" },
    { options: ["xc:#2060b080", "-compose", "multiply", "-set", "label", "%[compose]", "-compose", "cOpY"], format: "%[label]:%[COMPOSE]", expected: "Multiply:Copy" },
    { options: ["xc:#2060b080", "-compose", "Multiply", "-compose", "Copy"], expected: "Copy" },
    { options: ["-compose", "Multiply", "xc:#2060b080"], expected: "Multiply" },
    { options: ["xc:#2060b080", "-compose", "Multiply", "+compose"], expected: "Over" },
    { options: ["xc:#2060b080", "-compose", "Multiply", "-set", "label", "%[compose]", "-compose", "Copy"], format: "%[label]:%[COMPOSE]", expected: "Multiply:Copy" },
    { options: ["xc:#2060b080", "-compose", "Multiply", "xc:red"], expected: "Multiply:ba:Multiply" }
  ])("reports $expected for $options", async ({ options, expected, format = "%[compose]" }) => {
    const args = [...options, "-format", `a:${format}:b`, "info:/out"];
    const initial = new TextEncoder().encode("KEEP");
    if (mode === "sync") {
      const files = new Map([["/out", initial]]);
      expect(runMagickCliSync(args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(new TextDecoder().decode(files.get("/out"))).toBe(`a:${expected}:b`);
    } else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/out", initial);
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe(`a:${expected}:b`);
    }
  });
});
