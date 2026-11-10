import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const ink = Buffer.concat([
    Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"),
    Buffer.from([25, 80, 200, 10, 200, 31, 0, 150, 60, 128, 220, 201, 0, 0, 0, 255, 254, 253, 252, 1])
]);
const inkAlpha = Buffer.concat([
    Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 5\nMAXVAL 255\nTUPLTYPE CMYK_ALPHA\nENDHDR\n"),
    Buffer.from([25, 80, 200, 10, 40, 200, 31, 0, 150, 210, 60, 128, 220, 201, 120, 0, 0, 0, 255, 255, 254, 253, 252, 1, 0])
]);
const rgbaSamples = [61000, 6000, 0, 0, 15000, 48000, 10, 11000, 32768, 32767, 32766, 32767, 50000, 16000, 38000, 32768, 0, 11000, 65535, 65535];
const rgbaBytes = Buffer.alloc(rgbaSamples.length * 2);
rgbaSamples.forEach((sample, index) => rgbaBytes.writeUInt16BE(sample, index * 2));
const rgba = Buffer.concat([
    Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), rgbaBytes
]);
const inspect = ["-format", "%[colorspace] %[fx:p{1,0}.r] %[fx:p{1,0}.k]", "info:out"];

// Native ImageMagick 7.1.2-35 Q16-HDRI: inspect CMYK directly and decode PNG64 as RGBA16.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["ink", ["-channel", "K", "-white-threshold", "50%", "+channel", ...inspect], "CMYK 0.784314 1"],
        ["ink", ["-channel", "R", "-white-threshold", "50%", "+channel", ...inspect], "CMYK 1 0.588235"],
        ["ink", ["-channel", "Default", "-black-threshold", "50%", "+channel", ...inspect], "CMYK 0 0"],
        ["ink", ["-channel", "K", "-black-threshold", "50%", "+channel", "-channel", "K", "-separate", "PNG64:out"],
            "000000000000ffff969696969696ffffc9c9c9c9c9c9ffffffffffffffffffff000000000000ffff"],
        ["ink", ["-channel", "K", "-separate", "PNG64:out"],
            "0a0a0a0a0a0affff969696969696ffffc9c9c9c9c9c9ffffffffffffffffffff010101010101ffff"],
        ["ink", ["-channel", "R", "-separate", "PNG64:out"],
            "191919191919ffffc8c8c8c8c8c8ffff3c3c3c3c3c3cffff000000000000fffffefefefefefeffff"],
        ["rgba", ["-channel", "Default", "-black-threshold", "50%", "+channel", "PNG64:out"],
            "00000000000000003a98bb80000a0000000000000000000000000000000000000000000000000000"],
        ["rgba", ["-channel", "Default", "-white-threshold", "50%", "+channel", "PNG64:out"],
            "ee48177000000000ffffffffffff2af880007fff7ffe7fffc3503e809470800000002af8ffffffff"],
        ["alpha", ["-channel", "K", "-black-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "1950c80028c81f0096d23c80dcc978000000fffffefdfc0000"],
        ["alpha", ["-channel", "K", "-white-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "1950c80a28c81f00ffd23c80dcff78000000fffffefdfc0100"],
        ["alpha", ["-channel", "R", "-black-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "0050c80a28c81f0096d20080dcc978000000fffffefdfc0100"],
        ["alpha", ["-channel", "R", "-white-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "1950c80a28ff1f0096d23c80dcc978000000fffffffdfc0100"],
        ["alpha", ["-channel", "A", "-black-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "1950c80a00c81f0096003c80dcc900000000fffffefdfc0100"],
        ["alpha", ["-channel", "A", "-white-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "1950c80a28c81f0096d23c80dcc978000000fffffefdfc0100"],
        ["alpha", ["-channel", "Default", "-black-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "0000000000000000000000000000000000000000fefdfc0100"],
        ["alpha", ["-channel", "Default", "-white-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "1950c80a28c81f0096d23c80dcc978000000ffffffffffff00"],
        ["alpha", ["-channel", "CMYKA", "-black-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "0000c80000c8000096000080dcc900000000fffffefdfc0000"],
        ["alpha", ["-channel", "CMYKA", "-white-threshold", "50%", "+channel", "-depth", "8", "PAM:out"], "1950ff0a28ff1f00ffd23cffffff78000000ffffffffff0100"],
        ["alpha", ["-channel", "CMYKA", "-white-threshold", "20000,30000,40000,50000", "+channel", "-depth", "8", "PAM:out"], "1950ff0a28ff1f0096ff3cffffff78000000ffffffffff0100"],
        ["alpha", ["-channel", "CMYKA", "-white-threshold", "20000,30000,40000,50000,10000", "+channel", "-depth", "8", "PAM:out"], "1950ff0a28ff1f0096ff3cffffff78000000ffffffffff0100"]
    ] as const)(`thresholds %s via ${mode}: %j`, async (input, args, expected) => {
        const files = new Map<string, Uint8Array>([["in.pam", input === "ink" ? ink : input === "alpha" ? inkAlpha : rgba], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argv = ["in.pam", ...args];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        if (args.at(-1) === "info:out") expect(new TextDecoder().decode(output)).toBe(expected);
        else if (args.at(-1) === "PAM:out") {
            expect(Buffer.from(output)).toEqual(Buffer.concat([inkAlpha.subarray(0, inkAlpha.length - 25), Buffer.from(expected, "hex")]));
        } else {
            const image = decodeImage(output);
            expect([image.width, image.height, image.depth]).toEqual([5, 1, "ushort"]);
            expect([...image.data16!].map(value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
        }
    });
}
