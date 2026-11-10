import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { operator: "-level-colors", colors: "red,blue,green", expected: "f0f0ffff9191eeeeffffe7e73c3cffff4141" },
        { operator: "+level-colors", colors: "red,blue,bogus", expected: "f0f000009191eeee0000e7e73c3c00004141" },
        { operator: "-level-colors", colors: "red,blue", expected: "f0f0ffff9191eeeeffffe7e73c3cffff4141" },
        { operator: "+level-colors", colors: "red,blue", expected: "f0f000009191eeee0000e7e73c3c00004141" },
        { operator: "-level-colors", colors: "rgb(10,20,30),rgb(120,140,180)", expected: "0ba38000c444104affffffffffffffff3bbc" },
        { operator: "-level-colors", colors: "rgb(10,20,30),rgb(120,140,180),bogus,green", expected: "0ba38000c444104affffffffffffffff3bbc" },
        { operator: "-level-colors", colors: "red,blue,", expected: "f0f0ffff9191eeeeffffe7e73c3cffff4141" }
    ])(`${mode}: $operator '$colors' matches native endpoint bytes`, async ({ operator, colors, expected }) => {
        const files = new Map([
            ["a.ppm", new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n")],
            ["out", new TextEncoder().encode("KEEP")]
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["a.ppm", operator, colors, "-endian", "MSB", "-depth", "16", "rgb:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(0);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
