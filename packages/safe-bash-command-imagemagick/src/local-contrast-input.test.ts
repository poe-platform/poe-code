import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new Uint8Array(Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Buffer.from("ff000000ff000000ff40a0209020a0101220", "hex")
]));

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { args: ["-local-contrast", "10x20", "/in.ppm"], empty: true },
        { args: ["/in.ppm", "(", "-local-contrast", "10x20", "/in.ppm", ")"], empty: true },
        { args: ["/in.ppm", "+delete", "-local-contrast", "10x20", "/in.ppm"], empty: true },
        { args: ["/in.ppm", "-local-contrast", "10x20"], empty: false },
        { args: ["/in.ppm", "/in.ppm", "-local-contrast", "10x20"], empty: false },
        { args: ["/in.ppm", "(", "/in.ppm", "-local-contrast", "10x20", ")"], empty: false }
    ])(`validates the current local-contrast image list via ${mode}: $args`, async ({ args, empty }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out.ppm", keep]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const argv = [...args, "/out.ppm"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "magick" || mode === "convert" ? {
            ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.ppm") : await fs.readFile("/out.ppm");
        expect.soft(result.exitCode).toBe(empty ? 1 : 0);
        expect.soft(result.stdout).toBe("");
        if (empty) {
            expect.soft(result.stderr).toContain("no images found for operation '-local-contrast'");
            expect.soft(output).toEqual(keep);
        } else {
            expect.soft(result.stderr).toBe("");
            expect(output).not.toEqual(keep);
        }
    });
}
