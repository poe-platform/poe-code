import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 pixels for the second frame.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const operation of [["-coalesce"], ["-layers", "coalesce"]])
    it.each([
        { first: "R", second: "", pixel: "00ffffff" },
        { first: "B", second: "", pixel: "ffffffff" },
        { first: "", second: "", pixel: "0000ffff" },
        { first: "", second: "R", pixel: "0000ffff" },
    ])(`${mode} ${operation.join(" ")}: coalesce uses the first channel mask ($first/$second)`, async ({ first, second, pixel }) => {
        const argv = ["-respect-parentheses",
            "(", "xc:red", ...(first ? ["-channel", first] : []), ")",
            "(", "xc:blue", ...(second ? ["-channel", second] : []), ")",
            ...operation, "-delete", "0", "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(pixel);
    });
