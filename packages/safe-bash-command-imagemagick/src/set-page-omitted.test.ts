import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -set page and -repage have different defaults.
const cases = [
    { options: ["-set", "page", "x5"], page: "0x5+2+1" },
    { options: ["-set", "page", "0"], page: "0x4+2+1" },
    { options: ["-set", "page", "0x5"], page: "0x5+2+1" },
    { options: ["-set", "page", "5"], page: "5x4+2+1" },
    { options: ["-set", "page", "+3+2"], page: "7x4+3+2" },
    { options: ["-repage", "x2"], page: "7x4+2+1" },
    { options: ["-repage", "0"], page: "0x0+2+1" },
];

for (const mode of ["sync", "command", "buffered", "retained"] as const) {
    for (const { options, page } of cases) {
        it(`preserves omitted page dimensions for ${options.join(" ")} via ${mode}`, async () => {
            const input = await sharp(Buffer.from("ff000000ff000000ffffff0000ffffff00ff", "hex"), {
                raw: { width: 3, height: 2, channels: 3 }
            }).png().toBuffer();
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
            const fs = new MemoryFileSystem();
            for (const [path, data] of files) await fs.writeFile(path, data);
            for (const flatten of [false, true]) {
                if (flatten && options.join(" ") !== "-set page x5") continue;
                const argv = ["/in.png", "-repage", "7x4+2+1", ...options,
                    ...(flatten ? ["-background", "black", "-flatten", "PNG32:/out.png"] : ["-format", "%wx%h|%g", "info:"])];
                let stdout = "", stderr = "";
                const argumentValues = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
                if (!flatten) {
                    expect("stdout" in result ? result.stdout : stdout).toBe(`3x2|${page}`);
                    expect(output).toEqual(keep);
                } else {
                    const decoded = decodeImage(output);
                    expect([decoded.width, decoded.height]).toEqual([3, 5]);
                    expect(decoded.virtualCanvas ?? { width: 3, height: 5, x: 0, y: 0 }).toEqual({ width: 3, height: 5, x: 0, y: 0 });
                    // The offset clips all but the first column of each input row.
                    const expected = new Uint8Array(60);
                    for (let offset = 3; offset < expected.length; offset += 4) expected[offset] = 255;
                    expected.set([255, 0, 0, 255], 20);
                    expected.set([255, 255, 0, 255], 32);
                    expect(decoded.data).toEqual(expected);
                }
            }
        });
    }
}
