import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: deprecated options fail with 1, unknown options with 11.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { options: ["+roll", "+1+1"], exitCode: 1, error: "option deprecated, unable to execute '+roll'" },
        { options: ["+chop", "1x1"], exitCode: 1, error: "option deprecated, unable to execute '+chop'" },
        { options: ["+splice", "1x1"], exitCode: 1, error: "option deprecated, unable to execute '+splice'" },
        { options: ["+colors"], exitCode: 1, error: "option deprecated, unable to execute '+colors'" },
        { options: ["+color-matrix", "1"], exitCode: 1, error: "option deprecated, unable to execute '+color-matrix'" },
        { options: ["-color-matrix", "1"], exitCode: 0, error: "" },
        { options: ["-made-up-matrix"], exitCode: 11, error: "unrecognized option '-made-up-matrix'" },
        { options: ["+solarize"], exitCode: 1, error: "option deprecated, unable to execute '+solarize'" },
        { options: ["+separate"], exitCode: 1, error: "option deprecated, unable to execute '+separate'" },
        { options: ["-separate"], exitCode: 0, error: "", pixels: [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255] },
        { options: ["-made-up-separate"], exitCode: 11, error: "unrecognized option '-made-up-separate'" },
        { options: ["+reverse"], exitCode: 1, error: "option deprecated, unable to execute '+reverse'" },
        { options: ["-reverse"], exitCode: 0, error: "" },
        { options: ["xc:blue", "xc:red", "+append", "+unique-colors"], exitCode: 1, error: "option deprecated, unable to execute '+unique-colors'" },
        { options: ["xc:blue", "xc:red", "+append", "+sort-pixels"], exitCode: 1, error: "option deprecated, unable to execute '+sort-pixels'" },
        { options: ["xc:blue", "xc:red", "+append", "-unique-colors"], exitCode: 0, error: "", pixels: [255, 0, 0, 255, 0, 0, 255, 255] },
        { options: ["xc:blue", "xc:red", "+append", "-sort-pixels"], exitCode: 0, error: "", pixels: [0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255] },
        { options: ["+bogus"], exitCode: 11, error: "unrecognized option '+bogus'" },
        { options: ["-colors", "2"], exitCode: 0, error: "" }
    ])(`matches native status and destination for $options (${mode})`, async ({ options, exitCode, error, pixels }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", original);
        const args = ["xc:red", ...options, "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(exitCode);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(error ? `magick: ${error}\n` : "");
        expect(mode === "buffered" || mode === "sync" ? files.get("out") : await filesystem.readFile("/out"))
            .toEqual(exitCode === 0 ? Uint8Array.from(pixels ?? [255, 0, 0, 255]) : original);
    });
}

it.each(["+reverse", "-reverse"])("matches the native info output for %s", async option => {
    const argumentValues = createCommandArguments(["xc:red", option, "-format", "%w", "info:-"]);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: new MemoryFileSystem(),
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(option === "+reverse" ? 1 : 0);
    expect(stdout).toBe(option === "+reverse" ? "" : "1");
    expect(stderr).toBe(option === "+reverse" ? "magick: option deprecated, unable to execute '+reverse'\n" : "");
});
