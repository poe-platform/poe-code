import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves offset-only reads of self-describing images.
const inputs = {
    pgm: new TextEncoder().encode("P2\n3 2\n255\n10 20 30\n40 50 60\n"),
    png: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAAEElEQVR4nGPgEpFj0DCyAQACdADTfkxjGgAAAABJRU5ErkJggg==", "base64"),
};

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const [format, input] of Object.entries(inputs)) {
        it.each([
            { extract: "+1+0", geometry: "3x2|3x2+0+0", hex: "0a141e28323c" },
            { extract: "+0+1", geometry: "3x2|3x2+0+0", hex: "0a141e28323c" },
            { extract: "-1-1", geometry: "3x2|3x2+0+0", hex: "0a141e28323c" },
            { extract: "+9+9", geometry: "3x2|3x2+0+0", hex: "0a141e28323c" },
            { extract: "2x1+1+1", geometry: "2x1|3x2+1+1", hex: "323c" },
            { extract: undefined, geometry: "3x2|3x2+0+0", hex: "0a141e28323c" },
        ])(`${mode} ${format} read with -extract $extract`, async ({ extract, geometry, hex }) => {
            const files = new Map<string, Uint8Array>([[`/in.${format}`, input], ["/out.raw", new TextEncoder().encode("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = [...(extract === undefined ? [] : ["-extract", extract]), `/in.${format}`,
                "-format", "%wx%h|%g", "-write", "info:", "-depth", "8", "gray:/out.raw"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe(geometry);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
            expect(Buffer.from(output).toString("hex")).toBe(hex);
        });
    }
}
