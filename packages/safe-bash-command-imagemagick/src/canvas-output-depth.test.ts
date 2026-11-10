import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inline canvases default to depth 16.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-append"], ["+append"], ["-smush", "0"], ["+smush", "0"],
    ["-flatten"], ["-mosaic"], ["-layers", "flatten"], ["-layers", "mosaic"], ["-layers", "merge"]])
it.each([
    { depth: undefined, output: "pam" },
    { depth: undefined, output: "info" },
    { depth: 16, output: "pam" },
    { depth: 8, output: "pam" }
])(`${mode} ${operation.join(" ")}: depth $depth, $output`, async ({ depth, output }) => {
    const argv = [...(depth === undefined ? [] : ["-depth", String(depth)]),
        "xc:#213234567890", "xc:#abcdef012345", ...operation,
        ...(output === "info" ? ["-format", "%z;"] : []), `${output}:-`];
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
            : new TextEncoder().encode("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
    if (output === "info") {
        expect(new TextDecoder().decode(bytes)).toBe("16;");
        return;
    }
    const joined = operation[0]!.endsWith("append") || operation[0]!.endsWith("smush");
    const horizontal = operation[0]!.startsWith("+");
    const header = `P7\nWIDTH ${joined && horizontal ? 2 : 1}\nHEIGHT ${joined && !horizontal ? 2 : 1}\nDEPTH ${joined ? 3 : 4}\nMAXVAL ${depth === 8 ? 255 : 65535}\nTUPLTYPE ${joined ? "RGB" : "RGB_ALPHA"}\nENDHDR\n`;
    const raster = joined ? depth === 8 ? "213478abee23" : "213234567890abcdef012345"
        : depth === 8 ? "abee23ff" : "abcdef012345ffff";
    expect(Buffer.from(bytes)).toEqual(Buffer.concat([Buffer.from(header), Buffer.from(raster, "hex")]));
});
