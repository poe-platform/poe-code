import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { alpha: "Deactivate", expected: "506070ff" },
    { alpha: "Deactivate", activate: true, expected: "50607000" },
    { alpha: "Deactivate", secondInactive: true, expected: "506070ff" },
    { alpha: "Deactivate", secondInactive: true, activate: true, expected: "50607000" },
    { alpha: "Associate", activate: true, expected: "18446200" },
    { alpha: "Disassociate", activate: true, expected: "ffffe000" },
    { alpha: "Deactivate", png: true, expected: "506070ff" },
    { alpha: "Deactivate", png: true, activate: true, expected: "50607000" },
    { alpha: "Deactivate", activate: true, depth: "16", expected: "5050606070700000" },
    { alpha: "Deactivate", operation: "Min", activate: true, expected: "20402000" },
    { alpha: "Deactivate", operation: "Max", activate: true, expected: "8080c000" },
    { alpha: "Deactivate", operation: "Median", activate: true, expected: "2080c000" },
    { alpha: "Deactivate", operation: "Median", activate: true, first: "#50505020", second: "#404040c0", expected: "50505000" },
    { alpha: "Off", expected: "50607060" },
    { alpha: undefined, expected: "50607070" },
])(`${mode}: sequence with inactive alpha %j`, async ({ alpha, activate = false, secondInactive = false, png = false, depth = "8", operation = "Mean", first = "#80402020", second = "#2080c0c0", expected }) => {
    const argv = ["-respect-parentheses",
        "(", `xc:${first}`, ...(alpha ? ["-alpha", alpha] : []), ")",
        "(", `xc:${second}`, ...(secondInactive ? ["-alpha", "Deactivate"] : []), ")",
        "-evaluate-sequence", operation, ...(activate ? ["-alpha", "Activate"] : []),
        "-depth", depth, "-endian", "MSB", png ? "PNG32:-" : "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(png ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});
