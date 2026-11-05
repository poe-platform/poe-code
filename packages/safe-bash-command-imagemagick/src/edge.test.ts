import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2: 8x8 gradient:black-white with red rectangle 2,2 5,5.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIBAMAAAA2IaO4AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAbUExURQAAACQkJElJSf8AAG1tbZKSkra2ttvb2////0PA254AAAABYktHRAiG3pV6AAAAB3RJTUUH6gsFBDAlqE4ZDwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wNVQwNDo0ODozNyswMDowMJ4uOvcAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDVUMDQ6NDg6MzcrMDA6MDDvc4JLAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA1VDA0OjQ4OjM3KzAwOjAwuGajlAAAAClJREFUCNdjYAABQSBgUDI2VmJwMTZ2YQg1Ng5lSDM2TmMoBwKGDiAAAGTDCBsiD8KiAAAAAElFTkSuQmCC", "base64");
const cases = [["0", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AK6u/wD///8A////AP///wD///8Arq7/AAAA/wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////AP///wD/////AAD//wAA//8AAP//AAD/AP///wD///8A////AP////8AAP//AAD//wAA//8AAP8A////AP///wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////CP///wD///8A////AP///wD///8A////AP///wj////////////////////9/////f///////////////////w=="], ["1", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AEZG/wCPj/8A2Nj/ANjY/wCPj/8ARkb/AAAA/wMDA/8Aubn//wAA//8AAP//AAD//wAA/wC5uf8DAwP/AAAA/wD/////AAD/AAAA/wAAAP//AAD/AP///wAAAP8DAwP/AP////8AAP8AAAD/AAAA//8AAP8A////AwMD/wAAAP8A/////wAA/2wAAP9sAAD//wAA/wD///8AAAD/AwMD/wC5uf8A////AP///wD///8A////ALm5/wMDA/9sbGz/bGxs/2xsbP9sbGz/bGxs/2xsbP9sbGz/bGxs/w=="], ["3", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AMjI/wD///8A////AP///wD///8AyMj/AAAA/wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////AP///wD/////AAD//wAA//8AAP//AAD/AP///wD///8A////AP////8AAP//AAD//wAA//8AAP8A////AP///wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////gP///wD///8A////AP///wD///8A////AP///4D//////////////////////////////////////////////w=="], ["2.2", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AMjI/wD///8A////AP///wD///8AyMj/AAAA/wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////AP///wD/////AAD//wAA//8AAP//AAD/AP///wD///8A////AP////8AAP//AAD//wAA//8AAP8A////AP///wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////gP///wD///8A////AP///wD///8A////AP///4D//////////////////////////////////////////////w=="]] as const;
for (const retained of [false, true])
it.each(cases)(`matches native edge radius %s (retained=${retained})`, async (radius, expected) => {
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-edge", radius, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(actual.data).toEqual(new Uint8Array(Buffer.from(expected, "base64")));
});

for (const retained of [false, true])
it(`preserves alpha across edge output chunks (retained=${retained})`, async () => {
    const width = 1031, pixels = Uint8Array.from({ length: width * 4 }, (_, i) => i % 256);
    const input = await sharp(pixels, { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-edge", "3", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(actual.data.filter((_, i) => i % 4 === 3)).toEqual(pixels.filter((_, i) => i % 4 === 3));
});
