import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI dimensions and byte counts.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { trim: true, separate: false, geometry: "1x1|3x1-1-1" },
        { trim: true, separate: true, geometry: "1x1|3x1-1-1" },
        { trim: true, separate: true, size: 1 },
        { trim: false, separate: true, geometry: "3x1|3x1+0+0" },
        { trim: false, separate: true, size: 3 },
    ])(`${mode}: keeps extra channels aligned after empty trim (trim=$trim, separate=$separate, size=$size)`, async ({ trim, separate, geometry, size }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["-size", "3x1", "xc:#404040", "-duplicate", "3",
            "(", "+size", "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine",
            ...(trim ? ["-trim"] : []),
            ...(separate ? ["+channel", "-channel", "Meta0", "-separate", "+channel"] : []),
            ...(geometry ? ["-format", "%wx%h|%g", "info:"] : ["-depth", "8", "gray:-"])];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(data) { chunks.push(data.slice()); } },
            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const warnings = "stderr" in result ? result.stderr : stderr;
        if (trim) expect(warnings).toContain("geometry does not contain image");
        else expect(warnings).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
            : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(chunks);
        if (geometry) expect(output.toString()).toBe(geometry);
        else expect(output.length).toBe(size);
    });
}
