import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([
    ["3x2+1+", false],
    ["3x2+1-", false],
    ["3x2+1", false],
    ["3x2+1+0", true],
    ["3x2+1+2+", true],
    ["3x2+1e+2+", false],
] as const)("recognizes whether %s supplies a Y ordinate", (geometry, hasYOffset) => {
    expect(parseMagickGeometry(geometry).hasYOffset).toBe(hasYOffset);
});

// ImageMagick 7.1.2-35 preserves Y for an omitted ordinate, including a bare sign.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["3x2+1+", "3x2|3x2+1+1;"],
        ["3x2+1-", "3x2|3x2+1+1;"],
        ["3x2+1", "3x2|3x2+1+1;"],
        ["3x2+1+0", "3x2|3x2+1+0;"],
        ["3x2+1+2+", "3x2|3x2+1+2;"],
        ["3x2+1+!", "3x2|3x2+2+1;"],
        ["3x2 +1+ ", "3x2|3x2+1+1;"],
    ])(`${mode}: repages a cropped image with %s`, async (geometry, expected) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1", "-repage", geometry,
            "-format", "%wx%h|%g;", "info:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
