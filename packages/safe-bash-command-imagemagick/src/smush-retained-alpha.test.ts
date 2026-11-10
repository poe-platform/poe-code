import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)

for (const testCase of [
    { name: "discrete", input: ["xc:#b5267382", "(", "xc:#297d3846", "-alpha", "discrete", ")"], direction: "+smush", gap: "0", hex: "b5267382297d3846" },
    { name: "discrete overlap", input: ["xc:#b5267382", "(", "xc:#297d3846", "-alpha", "discrete", ")"], direction: "+smush", gap: "-1", hex: "794b5aa4" },
    { name: "associate", input: ["(", "xc:#30201046", "-alpha", "associate", ")", "xc:blue"], direction: "-smush", gap: "0", hex: "0d0904460000ffff" },
    { name: "disassociate", input: ["(", "xc:#30201046", "-alpha", "disassociate", ")", "xc:blue"], direction: "-smush", gap: "0", hex: "af753a460000ffff" },
    { name: "off", input: ["xc:#b5267382", "(", "xc:#297d3846", "-alpha", "off", ")"], direction: "+smush", gap: "0", hex: "b5267382297d38ff" },
])
it(`${mode} ${testCase.direction}: ${testCase.name}`, async () => {
    const argv = [
        ...testCase.input, "-background", "none", testCase.direction, testCase.gap,
        "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out",
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
