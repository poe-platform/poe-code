import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { operator: "-level-colors", colors: "bogus,blue", hex: "ffffffff9191ffffffffe7e7ffffffff4141" },
        { operator: "+level-colors", colors: "red,bogus", hex: "f0f000000000eeee000000003c3c00000000" },
        { operator: "+level-colors", colors: "bogus,blue", hex: "00000000919100000000e7e7000000004141" },
        { operator: "-level-colors", colors: "black,blue", hex: "ffffffff9191ffffffffe7e7ffffffff4141" },
        { operator: "+level-colors", colors: "red,black", hex: "f0f000000000eeee000000003c3c00000000" },
    ])(`${mode}: $operator $colors matches native status and bytes`, async ({ operator, colors, hex }) => {
        for (const expanded of [false, true]) {
            for (const quiet of [false, true]) {
                const files = new Map([["a.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
                const fs = new MemoryFileSystem();
                for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
                const args = ["a.ppm", ...(quiet ? ["-quiet"] : []),
                    ...(expanded ? ["-set", "option:endpoints", colors, operator, "%[option:endpoints]"] : [operator, colors]),
                    "-endian", "MSB", "-depth", "16", "rgb:out"];
                let stdout = "", stderr = "";
                const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                    command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stdout).toBe("");
                expect(result.stderr).toBe(!quiet && colors.includes("bogus") ? "magick: unrecognized color `bogus'\n" : "");
                expect(Buffer.from(output).toString("hex")).toBe(hex);
            }
        }
    });
}
