import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const execution of ["command", "buffered", "sync"] as const) {
    for (const scenario of ["partial", "opaque", "opaque-control", "first-chunk", "last-chunk", "near-opaque-16"] as const) {
        it(`${execution}: OffIfOpaque handles ${scenario}`, async () => {
            const width = scenario.includes("chunk") ? 8200 : 3;
            const pixels = new Uint8Array(width * 4);
            for (let index = 0; index < pixels.length; index += 4) pixels.set([200, 50, 70, 255], index);
            if (scenario === "partial") pixels.set([0, 40, 90, 0, 80, 100, 150, 128]);
            if (scenario === "first-chunk") pixels[3] = 128;
            if (scenario === "last-chunk") pixels[pixels.length - 1] = 128;
            const input = scenario === "near-opaque-16"
                ? new TextEncoder().encode("# ImageMagick pixel enumeration: 1,1,0,65535,srgba\n0,0: (12345,23456,34567,65534)\n")
                : await sharp(pixels, { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
            const filename = scenario === "near-opaque-16" ? "in.txt" : "in.png";
            const argv = [filename, "-background", "#123456", ...(scenario.startsWith("opaque") ? ["-alpha", "opaque"] : []),
                ...(scenario === "opaque-control" ? [] : ["-alpha", "OffIfOpaque"]),
                "-write", scenario === "near-opaque-16" ? "PNG64:out.png" : "PNG32:out.png", "-format", "%[channels]", "info:"];
            const files = new Map<string, Uint8Array>([[filename, input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile(`/${filename}`, input);
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = execution === "sync" ? runMagickCliSync(argv, files)
                : execution === "buffered" ? await runMagickCli(argv, files)
                : await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
            expect(("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout).trim()).toBe(scenario === "opaque" ? "srgb  3.0" : "srgba 4.0");
            const output = decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
            expect([...(scenario === "near-opaque-16" ? output.data16! : output.data)])
                .toEqual(scenario === "near-opaque-16" ? [12345, 23456, 34567, 65534] : [...pixels]);
        });
    }
}
