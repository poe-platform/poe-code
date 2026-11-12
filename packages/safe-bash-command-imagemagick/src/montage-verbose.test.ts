import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const ppm = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
const fileDiagnostic = "in.ppm PPM 2x1 2x1+0+0 8-bit sRGB 17B 0.000u 0:00.000\n";
const colorDiagnostic = "xc:blue=>blue XC 1x1 1x1+0+0 16-bit sRGB 0.000u 0:00.000\n";
for (const mode of ["sync", "buffered", "retained", "command", "montage-command"] as const) {
  it.each([
    { inputs: ["-verbose", "in.ppm", "in.ppm"], stdout: "4,1:0.333333\n", stderr: fileDiagnostic + fileDiagnostic },
    { inputs: ["-verbose", "in.ppm", "xc:blue"], stderr: fileDiagnostic + colorDiagnostic },
    { inputs: ["-verbose", "+verbose", "in.ppm", "xc:blue"], stderr: "" },
    { inputs: ["in.ppm", "xc:blue"], stderr: "" },
    { inputs: ["in.ppm", "-verbose", "xc:blue"], stderr: colorDiagnostic },
    { inputs: ["-verbose", "in.ppm", "+verbose", "xc:blue"], stderr: fileDiagnostic },
    { inputs: ["in.ppm", "xc:blue", "-verbose"], stderr: "" },
  ])(`${mode} reports only inputs read with verbose enabled: $inputs`, async ({ inputs, stderr, stdout = "3,1:0.333333\n" }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", ppm);
    const files = new Map([["in.ppm", ppm]]);
    const args = [...inputs, "-tile", "2x1", "-geometry", "+0+0", "-format", "%w,%h:%[fx:1/3]\\n", "info:"];
    let result;
    if (mode === "command" || mode === "montage-command") {
      const command = mode === "command" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
      let stdout = "", diagnostics = "";
      const status = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostics += new TextDecoder().decode(chunk); } }
      });
      result = { ...status, stdout, stderr: diagnostics };
    } else result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toEqual({ exitCode: 0, stdout, stderr });
  });
}
