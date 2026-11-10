import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n4 3\n255\n"),
    ...Array.from({ length: 36 }, (_, i) => i * 7),
]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...["-sample", "-scale", "-resize", "-thumbnail"].flatMap(option => [
            { args: [option, "2x2!", "/in.ppm"], option },
            { args: ["/in.ppm", "+delete", option, "2x2!", "/in.ppm"], option },
        ]),
        // Decoded RGBA8 controls from ImageMagick 7.1.2-35.
        { args: ["/in.ppm"], option: undefined, width: 4, height: 3,
            pixels: "00070eff151c23ff2a3138ff3f464dff545b62ff697077ff7e858cff939aa1ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff" },
        { args: ["/in.ppm", "-sample", "2x2!"], option: undefined, width: 2, height: 2,
            pixels: "00070eff2a3138ffa8afb6ffd2d9e0ff" },
    ])(`${mode}: validates resize input order: $args`, async test => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out", keep);
        const argv = [...test.args, "PNG32:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (test.option !== undefined) {
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain(`no images found for operation '${test.option}'`);
            expect(output).toEqual(keep);
        } else {
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([test.width, test.height]);
            expect(Array.from(decoded.data, value => value.toString(16).padStart(2, "0")).join("")).toBe(test.pixels);
        }
    });
}
