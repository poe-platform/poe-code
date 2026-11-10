import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for the inline RGBA image.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { width: 1, values: [255], roll: ["-roll", "+1+1"] },
        { width: 2, values: [255, 0], roll: ["-roll", "+1+1"] },
        { width: 3, values: [255, 0, 0, 0, 0, 0], roll: ["-roll", "+1+1"] },
        { width: 1, values: [255], roll: [] },
        { width: 1, values: [255], roll: ["-roll", "+0+0"] },
        { width: 1, values: [255], roll: ["-roll", "+1+1"], raw: true },
    ])(`keeps short read-mask selection with rolled pixels: %j, ${mode}`, async ({ width, values, roll, raw }) => {
        const mask = Buffer.concat([Buffer.from(`P5\n${width} ${values.length / width}\n255\n`), Buffer.from(values)]);
        const files = new Map([["mask.pgm", mask]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/mask.pgm", mask);
        const args = [
            "xc:#11223340", "xc:#a0b0c080", "xc:#405060c0", "+append",
            "(", "xc:#d070a060", "xc:#3090a090", "xc:#e0a0f0b0", "+append", ")", "-append",
            "-read-mask", "mask.pgm", ...roll,
            ...(raw ? ["+read-mask", "-depth", "8", mode === "command" ? "rgba:-" : "rgba:out"] : ["-channel", "R", "-format", "%[fx:mean]", "info:-"]),
        ];
        let stdout = "", stderr = "";
        const chunks: Buffer[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { if (raw) chunks.push(Buffer.from(bytes)); else stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(raw ? "" : "0.0666667");
        if (raw) {
            const bytes = mode === "command" ? Buffer.concat(chunks) : mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
            expect(Buffer.from(bytes).toString("hex")).toBe("e0a0f0b0d070a0603090a090405060c011223340a0b0c080");
        }
    });
}
