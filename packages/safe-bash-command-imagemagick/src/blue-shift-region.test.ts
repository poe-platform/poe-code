import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("124080207f8081800080ff00fea09fff", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI, -size 4x1 -depth 8 rgba:input.raw.
// A masked BlueShiftImage queues fresh pixels: selected alpha is zero, and
// protected RGB is premultiplied by the source alpha during cache compositing.
const cases = [
    { options: ["-duplicate", "1", "-region", "2x1+1+0", "-blue-shift", "1", "+region"], expected: "020810208080810080a0bf00fea09fff".repeat(2) },
    { options: ["-region", "2x1+1+0", "-blue-shift", "1", "+region"], depth: "16", expected: "0245081010202020808080c0810100008000a020bfff0000fefea0a09f9fffff" },
    { options: ["-region", "2x1+1+1", "-blue-shift", "1", "+region"], size: "4x3", data: Buffer.from("124080207f8081800080ff00fea09fff124080807f8081200080fffffea09f40124080ff7f8081000080ff80fea09f20", "hex"), expected: "020810204040418000000000fea09fff0e2547808080818080a0bf00ecc3c340124080ff404041000040808052414120" },
    { options: ["-region", "2x2+1+0", "-blue-shift", "1", "+region"], size: "4x2", data: Buffer.from("124080207f8081800080ff00fea09fff124080807f8081200080fffffea09f40", "hex"), expected: "020810208080810080a0bf00fea09fff0e2547808080810080a0bf00ecc3c340" },
    { options: ["-region", "2x1+511+1", "-blue-shift", "1", "+region"], size: "516x2", data: Buffer.concat(Array(258).fill(input)), expected: "020810204040418000000000fea09fff".repeat(129) + "0a111b206060618000000000fea09fff".repeat(127) + "0a111b206060618000000000e6cfcfff495565206060618000000000fea09fff" },
    { options: ["-region", "2x1+1+0", "-blue-shift", "0", "+region"], expected: "020810202020200000204000fea09fff" },
    { options: ["-region", "2x1+1+0", "-blue-shift", "0.5", "+region"], expected: "020810205050500040608000fea09fff" },
    { options: ["-region", "2x1+1+0", "-blue-shift", "1", "+region"], expected: "020810208080810080a0bf00fea09fff" },
    { options: ["-region", "2x1+1+0", "-blue-shift", "1.5", "+region"], expected: "02081020b0b0b100bfdfff00fea09fff" },
    { options: ["-region", "2x1+1+0", "-blue-shift", "2", "+region"], expected: "02081020e0e1e100ffffff00fea09fff" },
    { options: ["-blue-shift", "1"], expected: "495565208080818080a0bf00e6cfcfff" },
    { options: ["-region", "2x1+1+0", "+region"], expected: input.toString("hex") },
    { options: ["-region", "4x1", "-blue-shift", "1", "+region"], expected: "495565008080810080a0bf00e6cfcf00" },
    { options: ["-channel", "R", "-region", "2x1+1+0", "-blue-shift", "1", "+region"], expected: "025565208080810080a0bf00fecfcfff" },
    { options: ["-alpha", "off", "-region", "2x1+1+0", "-blue-shift", "1", "+region"], expected: "124080ff808081ff80a0bffffea09fff" }
];

describe.each(["command", "retained", "buffered", "sync"] as const)("blue-shift region (%s)", mode => {
    it.each(cases)("matches native pixels for $options", async ({ options, expected, size = "4x1", data = input, depth = "8" }) => {
        const argv = ["-size", size, "-depth", "8", "rgba:/input.raw", ...options, "-depth", depth, "-endian", "MSB", "rgba:-"];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.raw", data);
        const files = new Map([["/input.raw", data]]);
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect(result.exitCode, error).toBe(0);
        expect(error).toBe("");
        const bytes = mode === "command" ? Buffer.concat(chunks)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
            : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(bytes.toString("hex")).toBe(expected);
    });
});
