import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

import fixtures from "./colorspace-hcl-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-31 Q16-HDRI, decoded PNG32 RGBA8.
const input = Buffer.from(fixtures.input, "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: matches native HCL conversion $args`, async ({ args: options, rgba, text }) => {
        const argv = ["in.png", ...options, "-write", "PNG32:out.png", "-format", "%[colorspace] %[pixel:p{0,0}]", "info:"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        let stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([8, 8]);
        expect([...output.data]).toEqual([...Buffer.from(rgba, "base64")]);
        expect(("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout).trim()).toBe(text);
    });
}

for (const retained of [false, true]) {
    it.each(["HCL", "HCLp"])(`preserves alpha and text precision in %s, retained=${retained}`, async space => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        for (const output of ["info:", "txt:-", "histogram:info:-"]) {
            const result = await runConvertCli(["-size", "1x1", "xc:rgba(39,69,86,0.4)", "-colorspace", space.toLowerCase(), "-format", "%[pixel:p{0,0}]", ...(output === "histogram:info:-" ? ["-format", "%c"] : []), output], input);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stdout).toContain(`${space.toLowerCase()}a(201.702,18.4314%,24.3054%,0.4)`);
        }
        for (const color of ["black", "white", "red", "lime", "blue"]) {
            const expected = await runConvertCli([`xc:${color}`, "-format", "%[pixel:p{0,0}]", "info:"], input);
            const actual = await runConvertCli([`xc:${color}`, "-colorspace", space, "-colorspace", "sRGB", "-format", "%[pixel:p{0,0}]", "info:"], input);
            expect(actual.exitCode, actual.stderr).toBe(0);
            expect(actual.stdout).toBe(expected.stdout);
        }
    });
}
