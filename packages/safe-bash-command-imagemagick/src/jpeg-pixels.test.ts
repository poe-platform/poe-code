import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
function magick(args: string[], input: Uint8Array): Buffer {
    const result = spawnSync("magick", args, { input });
    expect(result.status, result.stderr.toString()).toBe(0);
    return result.stdout;
}
for (const size of [1, 8, 19]) for (const retained of [false, true]) {
    it.skipIf(!nativeAvailable)(`matches native JPEG pixels at ${size}x${size}, retained=${retained}`, async () => {
        const raw = size === 1 ? Uint8Array.of(40, 100, 180, 255) : Uint8Array.from({ length: size * size * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
        const png = magick(["-size", `${size}x${size}`, "-depth", "8", "RGBA:-", "png:-"], raw);
        const native = magick(["png:-", "-sampling-factor", "1x1", "-quality", "90", "jpeg:-"], png);
        const expected = magick(["jpeg:-", "-depth", "8", "RGBA:-"], native);
        if (size === 1) expect([...expected]).toEqual([39, 100, 180, 255]);
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["in.png", png]]);
        await fs.writeFile("/in.png", png);
        const result = await runConvertCli(["in.png", "-sampling-factor", "1x1", "-quality", "90", "-write", "copy.jpg", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        for (const path of ["copy.jpg", "out.jpg"]) {
            const output = retained ? await fs.readFile(`/${path}`) : files.get(path)!;
            expect(magick(["identify", "-format", "%Q %[jpeg:sampling-factor]", "jpeg:-"], output).toString()).toBe("90 1x1,1x1,1x1");
            expect(magick(["jpeg:-", "-depth", "8", "RGBA:-"], output)).toEqual(expected);
        }
    });
}

// ImageMagick 7.1.2 native fixtures keep the regression active without a native binary.
const nativeFixtures = [
    {
        "size": 1,
        "png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURShktFy587QAAAAHdElNRQfqCwUXHTj1AjIQAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA1VDIzOjI5OjU2KzAwOjAwZVxbTAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wNVQyMzoyOTo1NiswMDowMBQB4/AAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDVUMjM6Mjk6NTYrMDA6MDBDFMIvAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
        "jpeg": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ABxQocf/2Q=="
    },
    {
        "size": 8,
        "png": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAMAAADz0U65AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAADAUExURRERETZsRlvHe4AisKV95crYGu8zTxSOhDnpuV5E7oOfI6j6WM1VjfKwwhcL9zxmLGHBYYYclqt3y9DSAPUtNRqIaj/jn2Q+1ImZCa70PtNPc/iqqB0F3UJgEme7R4wWfLFxsdbM5vsnGyCCUEXdhWo4uo+T77TuJNlJWf6kjiP/w0ha+G21LZIQYrdrl9zGzAEhASZ8NkvXa3AyoJWN1broCt9DPwSedCn5qU5U3nOvE5gKSL1lfeLAsgcb5yx2HA8EifQAAAAHdElNRQfqCwUXHTmCBQKGAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA1VDIzOjI5OjU3KzAwOjAwwytQ+AAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wNVQyMzoyOTo1NyswMDowMLJ26EQAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDVUMjM6Mjk6NTcrMDA6MDDlY8mbAAAAUElEQVQI12NgYGRiZmFlY2fg4OTi5uHl42cQEBQSFhEVE2eQkJSSlpGVk2dQUFRSVlFVU2fQ0NTS1tHV02cwMDQyNjE1M2ewsLSytrG1swcAu/gH4YyumyAAAAAASUVORK5CYII=",
        "jpeg": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABwQAAIDAAMBAAAAAAAAAAAAAAIDAQQFBhESI//EABUBAQEAAAAAAAAAAAAAAAAAAAAD/8QAHhEAAwADAAIDAAAAAAAAAAAAAQIDBBESACIFIzH/2gAMAwEAAhEDEQA/ADtDlMygy86ynD41FcD02nTmu6mt7OlgSvkaxRcXIikYn1DYieok/ccY1Qm9vsoPxODwCkSS7T0xi1Yvs5CMQgQvyHdT4lTHOC8/jyRjKPexJ1blfZE2GJFYuA7kB6OOFBXnv//Z"
    }
];
for (const fixture of nativeFixtures) for (const retained of [false, true]) {
    it(`matches frozen native JPEG pixels at ${fixture.size}x${fixture.size}, retained=${retained}`, async () => {
        const png = Buffer.from(fixture.png, "base64");
        const files = new Map<string, Uint8Array>([["in.png", png]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", png);
        const result = await runConvertCli(["in.png", "-sampling-factor", "1x1", "-quality", "90", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = retained ? await fs.readFile("/out.jpg") : files.get("out.jpg")!;
        expect(decodeImage(output).data).toEqual(decodeImage(Buffer.from(fixture.jpeg, "base64")).data);
    });
}
