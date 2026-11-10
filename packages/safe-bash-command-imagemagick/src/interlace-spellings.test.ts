import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const pixels = Buffer.from("204080305090", "hex");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { options: ["-interlace", "Undefined"], output: "png", expected: "1" },
    { options: ["-interlace", "Undefined"], output: "raw", expected: "204080305090" },
    { options: ["-interlace", "Undefined"], output: "info", expected: "Undefined/Undefined" },
    { options: ["-interlace", "p_l_a_n_e"], output: "info", expected: "Plane/p_l_a_n_e" },
    { options: ["-interlace", "pl-ane"], output: "raw", expected: "203040508090" },
    { options: ["-interlace", " Plane "], output: "raw", expected: "203040508090" },
    { options: ["-interlace", " Plane "], output: "info", expected: "Plane/ Plane " },
    { options: ["-interlace", "pLaNe"], output: "info", expected: "Plane/pLaNe" },
    { options: ["-interlace", "P_N-G"], output: "info", expected: "PNG/P_N-G" },
    { options: ["-interlace", "U_n-deFiNed"], output: "info", expected: "Undefined/U_n-deFiNed" },
    { options: ["-interlace", "Plane", "-interlace", "Undefined"], output: "raw", expected: "204080305090" },
    { options: ["-interlace", "Plane", "+interlace"], output: "png", expected: "1" },
    { options: [], output: "png", expected: "0" },
    { options: ["-interlace", "None"], output: "png", expected: "0" },
    { options: ["-interlace", "Undefined", "-interlace", "None"], output: "png", expected: "0" },
    { options: ["-interlace", "Bogus"], output: "raw", expected: "", exitCode: 1 },
    { options: ["-interlace", ""], output: "raw", expected: "", exitCode: 1 },
    { options: ["-interlace", "pl ane"], output: "raw", expected: "", exitCode: 1 },
  ])(`${mode}: $options with $output output`, async ({ options, output, expected, exitCode = 0 }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#204080", "xc:#305090", "+append", ...options,
      ...(output === "info" ? ["-format", "%[interlace]/%[option:interlace]", "info:-"]
        : output === "raw" ? ["-depth", "8", "rgb:-"] : ["PNG24:-"])];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? {
      ...await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr
    } : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(exitCode);
    const bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
    if (exitCode === 0) expect(result.stderr).toBe("");
    if (output === "png") {
      expect(bytes[28]).toBe(Number(expected));
      expect(await sharp(bytes).removeAlpha().raw().toBuffer()).toEqual(pixels);
    } else expect(bytes.toString(output === "raw" ? "hex" : "utf8")).toBe(expected);
  });
}
