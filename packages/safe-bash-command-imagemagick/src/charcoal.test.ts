import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2: 8x8 gradient:black-white, red rectangle 2,2 5,5.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIBAMAAAA2IaO4AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAbUExURQAAACQkJElJSf8AAG1tbZKSkra2ttvb2////0PA254AAAABYktHRAiG3pV6AAAAB3RJTUUH6gsFBDAlqE4ZDwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wNVQwNDo0ODozNyswMDowMJ4uOvcAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDVUMDQ6NDg6MzcrMDA6MDDvc4JLAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA1VDA0OjQ4OjM3KzAwOjAwuGajlAAAAClJREFUCNdjYAABQSBgUDI2VmJwMTZ2YQg1Ng5lSDM2TmMoBwKGDiAAAGTDCBsiD8KiAAAAAElFTkSuQmCC", "base64");
const cases: [string, number[]][] = [["0x1", [249, 233, 223, 220, 220, 223, 233, 249, 187, 174, 168, 170, 170, 168, 174, 187, 109, 122, 152, 174, 174, 152, 122, 109, 65, 102, 160, 196, 196, 160, 102, 65, 54, 94, 156, 194, 194, 156, 94, 54, 53, 77, 124, 152, 152, 124, 77, 53, 39, 41, 62, 74, 74, 62, 41, 39, 15, 14, 13, 12, 12, 13, 14, 15]], ["0x2", [243, 245, 247, 249, 249, 247, 245, 243, 201, 209, 217, 220, 220, 217, 209, 201, 157, 172, 183, 191, 191, 183, 172, 157, 118, 136, 154, 166, 166, 154, 136, 118, 84, 104, 125, 139, 139, 125, 104, 84, 54, 72, 91, 103, 103, 91, 72, 54, 31, 39, 53, 61, 61, 53, 39, 31, 18, 16, 16, 21, 21, 16, 16, 18]], ["1x2", [253, 229, 194, 170, 170, 194, 229, 253, 222, 183, 136, 127, 127, 136, 183, 222, 180, 127, 87, 124, 124, 87, 127, 180, 149, 103, 104, 201, 201, 104, 103, 149, 139, 92, 100, 214, 214, 100, 92, 139, 149, 75, 38, 108, 108, 38, 75, 149, 126, 62, 26, 39, 39, 26, 62, 126, 94, 51, 26, 26, 26, 26, 51, 94]], ["2.2x2", [245, 240, 236, 236, 236, 236, 240, 245, 193, 198, 203, 208, 208, 203, 198, 193, 139, 156, 173, 190, 190, 173, 156, 139, 95, 124, 156, 185, 185, 156, 124, 95, 67, 105, 147, 184, 184, 147, 105, 67, 48, 77, 109, 137, 137, 109, 77, 48, 29, 42, 62, 80, 80, 62, 42, 29, 15, 14, 18, 26, 26, 18, 14, 15]], ["0x0", [255, 255, 255, 255, 255, 255, 255, 255, 255, 118, 54, 54, 54, 54, 118, 255, 54, 54, 201, 201, 201, 201, 54, 54, 54, 54, 201, 201, 201, 201, 54, 54, 54, 54, 201, 201, 201, 201, 54, 54, 54, 54, 201, 201, 201, 201, 54, 54, 53, 54, 54, 54, 54, 54, 54, 53, 0, 0, 0, 0, 0, 0, 0, 0]]];
it.each(cases)("matches native charcoal %s in buffered and retained paths", async (geometry, expected) => {
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["input.png", "-charcoal", geometry, "out.png"];
    expect((await runConvertCli(args, files)).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    const actual = decodeImage(files.get("out.png")!);
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(actual);
    for (let i = 0; i < expected.length; i++) {
        for (let c = 0; c < 3; c++) expect(Math.abs(actual.data[i * 4 + c]! - expected[i]!)).toBeLessThanOrEqual(1);
        expect(actual.data[i * 4 + 3]).toBe(255);
    }
});
