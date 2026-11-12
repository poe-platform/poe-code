import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA output after explicit sRGB export.
for (const mode of ["sync", "map", "retained", "command"] as const)
for (const width of [1, 513]) {
  it.each([
    { first: "CMYK", second: "sRGB", operation: "And", firstColor: "#2f609070", secondColor: "#402010c0", expected: "90909070" },
    { first: "CMYK", second: "sRGB", operation: "Threshold", firstColor: "#2f609070", secondColor: "#402010c0", expected: "90900070" },
    { first: "CMYK", second: "sRGB", operation: "Mean", firstColor: "#2f609070", secondColor: "#402010c0", expected: "6b9ac138" },
    { first: "CMYK", second: "sRGB", operation: "Max", firstColor: "#2f609070", secondColor: "#402010c0", expected: "2f608770" },
    { first: "CMYK", second: "sRGB", operation: "Mean", expected: "c84e9a41" },
    { first: "sRGB", second: "CMYK", operation: "Mean", expected: "3bb05f23" },
    { first: "CMYK", second: "sRGB", operation: "Max", expected: "98267382" },
    { first: "sRGB", second: "CMYK", operation: "Max", expected: "246a3846" },
    { first: "CMYK", second: "CMYK", operation: "Mean", expected: "665d5364" },
    { first: "sRGB", second: "sRGB", operation: "Mean", expected: "6f525664" },
  ])(`${mode}, width=${width}: $first then $second, $operation`, async ({ first, second, operation, firstColor = "#b5267382", secondColor = "#297d3846", expected }) => {
    const fs = createMemoryFileSystem(), files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("/out")!);
    const argv = ["-respect-parentheses", "(", "-size", `${width}x1`, `xc:${firstColor}`, "-colorspace", first, ")",
      "(", `xc:${secondColor}`, "-colorspace", second, ")", "-evaluate-sequence", operation,
      "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
    let stderr = "", stdout = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    const output = mode === "sync" || mode === "map" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(width));
  });
}
