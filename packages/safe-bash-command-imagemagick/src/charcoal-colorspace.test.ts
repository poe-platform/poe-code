import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI; RGB samples (17 + pixel * [37, 91, 53]) % 256.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAIAAADJUWIXAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMTBUMDM6MTY6MTErMDA6MDBQyYRMAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTEwVDAzOjE2OjExKzAwOjAwIZQ88AAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0xMFQwMzoxNjoxMSswMDowMHaBHS8AAAA5SURBVAjXYxQUFFSNNoUjlp3HOVWjOVWVOO8d57wXzcmy8zjnveOcO6M5VZU4VY9D+BBJJc6dxzkBSL0U0lBczXkAAAAASUVORK5CYII=", "base64");
const cases: [string, number[]][] = [["sRGB", [243, 205, 122, 57, 13, 66, 93, 74, 75, 123, 30, 60, 81, 95, 126, 164, 135, 148, 114, 42]], ["HSL", [235, 233, 212, 165, 152, 101, 114, 118, 85, 38, 104, 116, 120, 83, 11, 232, 217, 175, 120, 42]], ["Lab", [87, 146, 139, 62, 23, 129, 127, 107, 51, 43, 182, 132, 63, 37, 38, 213, 155, 49, 41, 70]], ["RGB", [255, 255, 255, 255, 242, 244, 255, 255, 253, 237, 219, 249, 253, 248, 246, 255, 255, 254, 235, 209]], ["CMYK", [223, 174, 119, 88, 114, 222, 141, 92, 62, 18, 198, 120, 58, 39, 17, 182, 110, 36, 58, 88]], ["Gray", [255, 225, 141, 78, 8, 59, 137, 149, 117, 133, 0, 70, 149, 144, 143, 129, 100, 181, 164, 35]]];
for (const mode of ["public", "sync"]) {
    it.each([["", cases[0]![1]], ...cases] as [string, number[]][])(`renders charcoal from %s and returns Gray (${mode})`, async (space, expected) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        await fs.writeFile("/out.png", new TextEncoder().encode("KEEP"));
        const files = new Map([["/input.png", new Uint8Array(input)], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const args = ["/input.png", ...(space ? ["-colorspace", space] : []), "-charcoal", "0x1", "-write", "PNG32:/out.png", "-format", "%[colorspace]|%[channels]|%z", "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "";
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(value: Uint8Array) { stdout += new TextDecoder().decode(value); } },
            stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(output.data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
        expect("stdout" in result ? result.stdout : stdout).toBe("Gray|gray  1.0|8");
    });
}

for (const mode of ["public", "sync"]) {
    it.each(["HSL", "Lab"])(`preserves the PNG round trip through %s (${mode})`, async space => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const files = new Map([["/input.png", new Uint8Array(input)]]);
        const args = ["/input.png", "-colorspace", space, "PNG32:/out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.data).toEqual(decodeImage(input).data);
    });
}
