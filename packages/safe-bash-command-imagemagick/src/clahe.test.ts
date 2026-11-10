import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

import fixtures from "./clahe-fixtures.json" with { type: "json" };

const input = new Uint8Array(readFileSync(new URL("./fixtures/clahe-input.png", import.meta.url)));
// ImageMagick 7.1.2-35 Q16-HDRI: ramp.png -clahe 8x8+32+3 clahe.png.
const expected = decodeImage(new Uint8Array(readFileSync(new URL("./fixtures/clahe-native.png", import.meta.url))));

for (const mode of ["buffered", "retained", "sync", "mogrify", "public"] as const) {
    it(`matches native CLAHE across all tile boundaries via ${mode}`, async () => {
        const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const args = ["input.png", "-clahe", "8x8+32+3", "out.png"];
        let result;
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const filesystem = new Proxy(fs, { get(target, key) {
                if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file CLAHE I/O forbidden"); };
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            } });
            result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } } });
            expect(stderr).toBe("");
        } else result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli(["-clahe", "8x8+32+3", "input.png"], files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "public" ? await fs.readFile("/out.png") : files.get(mode === "mogrify" ? "input.png" : "out.png")!);
        expect([output.width, output.height]).toEqual([16, 16]);
        expect(output.data).toEqual(expected.data);
        expect(createHash("sha256").update(output.data.filter((_, i) => i % 4 === 0)).digest("hex"))
            .toBe("1eaf96fb424ddb1c61e3c8d97da6b5e09c0790446229cd9298e0abc15c51d1bc");
    });
}

for (const retained of [false, true]) it.each(["", "bogus", "8x8+32+Infinity", "8x8+32+3junk", "1000000000x1000000000+32+3"])(`rejects invalid or excessive CLAHE geometry %s without replacing output (retained=${retained})`, async geometry => {
    const files = new Map([["input.png", input], ["out.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    await fs.writeFile("/out.png", input);
    const result = await runConvertCli(["input.png", "-clahe", geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("clahe");
    expect(retained ? await fs.readFile("/out.png") : files.get("out.png")).toEqual(input);
});

// Native Q16-HDRI raw RGBA (16-bit samples in big-endian order), generated from the same PNG inputs.
for (const fixture of fixtures) for (const retained of [false, true]) {
    it.each(fixture.cases)(`matches native color CLAHE at ${fixture.width}x${fixture.height}, depth ${fixture.depth} (retained=${retained}): $options`, async ({ options, hash }) => {
        const input = Buffer.from(fixture.input, "base64"), files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const result = await runConvertCli(["input.png", ...options, `PNG${fixture.depth === 16 ? 64 : 32}:out.png`], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([fixture.width, fixture.height]);
        let bytes = output.data;
        if (fixture.depth === 16) {
            expect(output.data16).toBeDefined();
            bytes = new Uint8Array(output.data16!.length * 2);
            const view = new DataView(bytes.buffer);
            output.data16!.forEach((value, i) => view.setUint16(i * 2, value));
        }
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
        expect(output.data.filter((_, i) => i % 4 === 3)).toEqual(decodeImage(input).data.filter((_, i) => i % 4 === 3));
    });
}

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each(["before", "after", "identity"] as const)(`checks CLAHE image ordering via ${mode}: %s`, async placement => {
        const keep = Buffer.from("KEEP"), files = new Map([["out", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const inputs = ["xc:#80562360", "xc:#40a0a0a0", "xc:#9070a0ea", "+append"];
        const clahe = ["-clahe", "2x2+16+2"];
        const args = [...(placement === "before" ? [...clahe, ...inputs]
            : placement === "after" ? [...inputs, "-set", "option:g", "2x2+16+2", ...clahe]
            : [...inputs, "-colorspace", "sRGB", "-colorspace", "sRGB"]), "-depth", "8", "rgba:out"];
        let exitCode: number, stderr = "";
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
        }
        expect(exitCode, stderr).toBe(placement === "before" ? 1 : 0);
        if (placement === "before") expect(stderr).toContain("no images found for operation '-clahe'");
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(placement === "before" ? "4b454550"
            : placement === "after" ? "9b6e3a60b2ffffa0cface0ea" : "8056236040a0a0a09070a0ea");
    });
}
