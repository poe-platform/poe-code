import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves both translucent sRGB pixels.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const width of [1, 1025])
for (const selection of ["region", "write-mask", "none"] as const)
it.each([
    { operation: [] },
    { operation: ["-colorspace", "sRGB"] },
    { operation: ["-set", "colorspace", "sRGB"] },
])(
    `${mode}, ${width} pixels per input, ${selection}: preserves current colorspace with $operation`, async ({ operation }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", `${width}x1`, "xc:#20406080", "xc:#804020c0", "+append",
            ...(selection === "none" ? [] : [`-${selection}`, selection === "region" ? "1x1+1+0" : "xc:white"]),
            ...operation, ...(selection === "none" ? [] : [`+${selection}`]), "-depth", "8", "rgba:-"];
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe("20406080".repeat(width) + "804020c0".repeat(width));
    });
