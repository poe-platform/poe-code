import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { precision: [], expected: "0.333333" },
    { precision: ["-precision", "3"], expected: "0.333" },
    { precision: ["-precision", "12"], expected: "0.333333333333" },
    { precision: ["-precision", "3", "-precision", "12"], expected: "0.333333333333" },
    { precision: ["-precision", "3", "+precision"], expected: "0.333" },
    { precision: ["-precision", "3", "-precision", "0"], expected: "0.333" },
    { precision: ["-precision", "3", "-precision", "-1"], expected: "0.333333" },
    { precision: ["-precision", "3.5"], expected: "0.333" }
  ])(`${mode}: formats montage numbers with $precision`, async ({ precision, expected }) => {
    const fs = new MemoryFileSystem();
    const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...precision, "-format", "%w,%h:%[fx:1/3]\\n", "info:"];
    let stdout = "", stderr = "";
    let result;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
    } else {
      result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
      stdout = result.stdout;
      stderr = result.stderr;
    }
    expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: `2,1:${expected}\n`, stderr: "" });
  });
}

for (const mode of ["retained", "buffered", "sync"] as const) {
  it.each([undefined, "", "oops"])(`${mode}: rejects invalid montage precision %s`, async value => {
    const args = ["xc:red", "-precision", ...(value === undefined ? [] : [value, "info:"])];
    const fs = new MemoryFileSystem();
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result).toEqual({
      exitCode: 1, stdout: "", stderr: value === undefined
        ? "montage: missing argument for -precision\n"
        : `montage: invalid argument for option '-precision': ${value}\n`
    });
  });
}
