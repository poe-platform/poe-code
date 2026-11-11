import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native PNG64: RGBA16 (R, 24001, 40961, 32769), R = 0, 16385, 65535.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAYAAABLcMj3AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTc6MDE6MjQrMDA6MDCIxdBnAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE3OjAxOjI0KzAwOjAw+Zho2wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNzowMToyNCswMDowMK6NSQQAAAAdSURBVAjXY2RgiD24gLGB0YGRgYGBgYFh/z8IDQA+ogRArvkWhAAAAABJRU5ErkJggg==", "base64");

it.each(["2", "0x2", "0x1p+1"])("handles gamma %s through the public command without truncating hexadecimal values", async gamma => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    await fs.writeFile("/out.png", input);
    const args = createCommandArguments(["in.png", "-gamma", gamma, "PNG64:out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    const output = await fs.readFile("/out.png");
    if (gamma === "0x1p+1") {
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain("gamma");
        expect([...output]).toEqual([...input]);
    } else {
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        // Native ImageMagick 7.1.2-35 gives identical samples for 2 and 0x2.
        expect([...decodeImage(output).data16!]).toEqual([
            0, 39660, 51811, 46341,
            32769, 39660, 51811, 46341,
            65535, 39660, 51811, 46341
        ]);
    }
});

// Native ImageMagick 7.1.2-31 Q16-HDRI: xc:#345caa80 OP VALUE.
for (const operator of ["-gamma", "+gamma"]) {
    it.each(["2", "+2", "-2", "0x2", "+0x2", "-0x2", "+0X2", "-0X2"])(`${operator} reads signed gamma %s pixels and metadata`, async value => {
        for (const metadata of [false, true]) {
            const args = createCommandArguments([
                "xc:#345caa80", operator, value,
                ...(metadata ? ["-format", "%[gamma]", "info:"] : ["-depth", "8", "rgba:-"])
            ]);
            const output: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { output.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const negative = value.startsWith("-");
            expect(Buffer.concat(output).toString(metadata ? "utf8" : "hex")).toBe(metadata
                ? negative ? "-0.909091" : "0.909091"
                : negative ? "ffffffff" : operator === "-gamma" ? "7399d0b5" : "0b217140");
        }
    });
}
