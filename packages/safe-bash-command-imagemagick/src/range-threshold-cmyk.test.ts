import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const inks = Buffer.concat([
    Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"),
    Buffer.from([25, 80, 200, 10, 200, 31, 0, 150, 60, 128, 220, 201, 0, 0, 0, 255, 254, 253, 252, 1])
]);
const inksWithAlpha = Buffer.concat([
    Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 5\nMAXVAL 255\nTUPLTYPE CMYK_ALPHA\nENDHDR\n"),
    Buffer.from([25, 80, 200, 10, 0, 200, 31, 0, 150, 75, 60, 128, 220, 201, 127, 0, 0, 0, 255, 201, 254, 253, 252, 1, 255])
]);
const rgba = Buffer.concat([
    Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ee481770000000003a98bb80000a2af880007fff7ffe7fffc3503e809470800000002af8ffffffff", "hex")
]);
const format = ["-format", "%[colorspace] %[fx:p{1,0}.r] %[fx:p{1,0}.k]", "info:out"];
const alphaFormat = ["-format", "%[colorspace] %[fx:p{1,0}.k] %[fx:p{1,0}.a]", "info:out"];
const threshold = ["-range-threshold", "10%,25%,60%,80%", "+channel"];
const separate = ["-channel", "K", "-separate", "PNG64:out"];

// ImageMagick 7.1.2-35 Q16-HDRI references: query inks directly or decode RGBA16.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "selected black ink", input: inks, args: ["-channel", "K", ...threshold, ...format], text: "CMYK 0.784314 1" },
        { name: "selected cyan ink via R", input: inks, args: ["-channel", "R", ...threshold, ...format], text: "CMYK 0.0784314 0.588235" },
        { name: "selected cyan ink via C", input: inks, args: ["-channel", "C", ...threshold, ...format], text: "CMYK 0.0784314 0.588235" },
        { name: "thresholded black plane", input: inks, args: ["-channel", "K", ...threshold, ...separate], pixels: "000000000000ffffffffffffffffffff0f0f0f0f0f0fffff000000000000ffff000000000000ffff" },
        { name: "black selection preserves alpha", input: inksWithAlpha, args: ["-channel", "K", ...threshold, ...alphaFormat], text: "CMYK 1 0.294118" },
        { name: "alpha selection preserves black", input: inksWithAlpha, args: ["-channel", "A", ...threshold, ...alphaFormat], text: "CMYK 0.588235 1" },
        { name: "unchanged ink query", input: inks, args: format, text: "CMYK 0.784314 0.588235" },
        { name: "unchanged black plane", input: inks, args: separate, pixels: "0a0a0a0a0a0affff969696969696ffffc9c9c9c9c9c9ffffffffffffffffffff010101010101ffff" },
        { name: "RGBA16 control", input: rgba, args: ["-channel", "R", ...threshold, "PNG64:out"], pixels: "0000177000000000dbf6bb80000a2af8ffff7fff7ffe7fff2f6c3e809470800000002af8ffffffff" }
    ])(`retains native range-threshold channels via ${mode}: $name`, async ({ input, args, text, pixels }) => {
        const keep = Buffer.from("KEEP");
        const files = new Map([["in.pam", input], ["out", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", input);
        await fs.writeFile("/out", keep);
        const argv = ["in.pam", ...args];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        if (text !== undefined) expect(new TextDecoder().decode(output)).toBe(text);
        else {
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([5, 1]);
            const expected = Buffer.from(pixels!, "hex");
            expect(Array.from(decoded.data16!)).toEqual(Array.from({ length: expected.length / 2 }, (_, index) => expected.readUInt16BE(index * 2)));
        }
    });
}
