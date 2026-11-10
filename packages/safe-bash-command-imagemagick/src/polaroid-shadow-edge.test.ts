import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including faint shadow-edge pixels.
for (const mode of ["command", "buffered", "sync"] as const) it.each([
    { options: [], angle: "12", bytes: 7392, hash: "d42a0e04ba67a8caa9f22a5e8c452e45a3ee4c08a736191d6220e03cb6a4ebe9" },
    { options: ["-interpolate", "nearest"], angle: "12", bytes: 7392, hash: "73d4abb17f1d603c3c4d029c7a08c5c57c2172e8d59e0559bcd9fe2c4ebc2749" },
    { options: ["-filter", "point"], angle: "12", bytes: 7392, hash: "79069a2ee9557f9c01f846b0dea0fffe368b296c43ffa3dfc289efbc216cb521" },
    { options: [], angle: "0", bytes: 4896, hash: "12837268ce85c50a91e9291a775d00e3874aaaa77955b2131686872151adeed4" },
    { options: [], angle: "12", format: "%wx%h,%Wx%H%X%Y", expected: "44x42,44x42-4-5" },
])(`${mode}: matches native patterned polaroid $angle $options $format`, async ({ options, angle, bytes, hash, format, expected }) => {
    const fs = new MemoryFileSystem();
    const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Buffer.from(Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256))]);
    const files = new Map([["im.ppm", input], ["out", Buffer.from("KEEP")]]);
    for (const [path, data] of files) await fs.writeFile(`/${path}`, data);
    const argv = ["-seed", "7", "im.ppm", ...options, "-polaroid", angle,
        ...(format ? ["-format", format, "info:out"] : ["-depth", "8", "rgba:out"])];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files) : mode === "buffered" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
    });
    expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
    const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
    if (format) expect(new TextDecoder().decode(output)).toBe(expected);
    else {
        expect(output.byteLength).toBe(bytes);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    }
});
