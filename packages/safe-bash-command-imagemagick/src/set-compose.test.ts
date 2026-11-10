import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Exact output from ImageMagick 7.1.2-35 Q16-HDRI.
describe.each(["command", "sync"] as const)("per-image compose (%s)", mode => {
  const layers = ["xc:#73889a", "xc:#8a3010"];
  const cases = [
    { options: ["xc:#73889a", "-set", "COMPOSE", "multiply"], format: "info", expected: "Multiply;" },
    { options: ["xc:#73889a", "-set", "label", "Multiply", "-set", "compose", "%[label]"], format: "info", expected: "Multiply;" },
    { options: ["xc:#73889a", "-set", "compose", "Multiply"], format: "info", expected: "Multiply;" },
    { options: ["xc:#73889a", "-set", "compose", "Multiply", "+set", "compose"], format: "info", expected: "Multiply;" },
    { options: ["xc:#73889a", "-set", "compose", "marker"], format: "info", expected: "Over;" },
    { options: ["xc:#73889a", "-set", "compose", "Multiply", "-set", "compose", "marker"], format: "info", expected: "Multiply;" },
  ];
  for (const operation of [["-flatten"], ["-mosaic"], ["-layers", "flatten"], ["-layers", "mosaic"], ["-layers", "merge"]]) {
    for (const { options, expected } of [
      { options: layers, expected: "8a3010" },
      { options: [...layers, "-compose", "Multiply"], expected: "3e1a0a" },
      { options: [...layers, "-set", "compose", "Multiply", "+compose"], expected: "8a3010" },
      { options: [...layers, "-set", "COMPOSE", "copy_red"], expected: "8affff" },
      { options: [...layers, "-set", "compose", "Multiply"], expected: "3e1a0a" },
      { options: [...layers, "-set", "compose", "Multiply", "+set", "compose"], expected: "3e1a0a" },
      { options: [...layers, "-set", "compose", "CopyRed"], expected: "8affff" },
      { options: ["xc:#73889a", "(", "xc:#8a3010", "-set", "compose", "CopyRed", ")"], expected: "8a889a" },
      { options: ["xc:#73889a", "-set", "compose", "CopyRed", "xc:#8a3010"], expected: "8a3010" },
    ]) cases.push({ options: [...options, ...operation], format: "rgb", expected });
  }
  it.each(cases)("$options -> $expected", async ({ options, format, expected }) => {
    const args = [...options, "-format", "%[compose];", "-depth", "8", `${format}:/out`];
    const initial = new TextEncoder().encode("KEEP");
    let output: Uint8Array;
    if (mode === "sync") {
      const files = new Map([["/out", initial]]);
      expect(runMagickCliSync(args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      output = files.get("/out")!;
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
      output = await fs.readFile("/out");
    }
    expect(format === "info" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(expected);
  });
});
