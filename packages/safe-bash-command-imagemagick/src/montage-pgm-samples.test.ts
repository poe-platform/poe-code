import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const geometry of ["3x1+0+0", "+0+0"])
for (const depth of [8, 16]) {
    it(`${mode}: preserves PGM samples with ${geometry} at depth ${depth}`, async () => {
        const source = Buffer.concat([Buffer.from("P5\n3 1\n65535\n"), Buffer.from("00011234fffe", "hex")]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/ramp.pgm", source);
        const files = new Map([["/ramp.pgm", source]]);
        const args = ["montage", "-tile", "x1", "-geometry", "1x1+0+0", "-geometry", geometry, "/ramp.pgm", "-depth", String(depth), "pgm:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(output!)).toEqual(Buffer.concat([
            Buffer.from(`P5\n3 1\n${depth === 16 ? 65535 : 255}\n`),
            Buffer.from(depth === 16 ? "00011234fffe" : "0012ff", "hex")
        ]));
    });
}
