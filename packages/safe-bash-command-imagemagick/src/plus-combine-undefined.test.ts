import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Undefined selects sRGB for +combine.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const { input, operation, output, expected } of [
    { input: ["xc:#124578"], operation: ["+combine", "Undefined"], output: "rgba", expected: "3e4578ff" },
    { input: ["xc:#12457890"], operation: ["+combine", "uNdEfInEd"], output: "rgba", expected: "3e457890" },
    { input: ["xc:#12457890", "-colorspace", "Lab"], operation: ["+combine", "Undefined"], output: "info", expected: "sRGB" },
    { input: ["xc:#12457890", "-colorspace", "Lab"], operation: ["-combine"], output: "info", expected: "CIELab" },
])
it(`${mode}: ${input.join(" ")} ${operation.join(" ")} ${output}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = [...input, ...operation, ...(output === "info"
        ? ["-format", "%[colorspace]", "info:/out"] : ["-depth", "8", "rgba:/out"])];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(expected);
});
