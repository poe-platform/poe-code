import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+append", "-append"])
for (const testCase of [
    { alpha: "discrete", second: false, hex: "b5267382297d3846" },
    { alpha: "associate", second: false, hex: "5c133b82297d3846" },
    { alpha: "discrete", second: true, hex: "b5267382297d3846" },
    { alpha: "off", second: false, hex: "b52673ff297d3846" },
])
it(`${mode} ${direction}: ${testCase.alpha} on ${testCase.second ? "second" : "first"} frame`, async () => {
    const argv = [
        "(", "xc:#b5267382", ...(!testCase.second ? ["-alpha", testCase.alpha] : []), ")",
        "(", "xc:#297d3846", ...(testCase.second ? ["-alpha", testCase.alpha] : []), ")",
        direction, "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out",
    ];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv);
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(testCase.hex);
});
