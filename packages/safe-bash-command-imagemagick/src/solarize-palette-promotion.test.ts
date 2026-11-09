import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: indexed RGB [20,60,100], [180,100,60], [75,155,195].
const indexed = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURRQ8ZLRkPEubw2TXsXQAAAAHdElNRQfqCwcUIDlAojzqAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIwOjMyOjU3KzAwOjAwwC89YgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMDozMjo1NyswMDowMLFyhd4AAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjA6MzI6NTcrMDA6MDDmZ6QBAAAADElEQVQI12NgYGQCAAAIAATnw6/5AAAAAElFTkSuQmCC", "base64");

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { operation: [], storage: "PseudoClass", last: [75, 100, 60, 255] },
        { operation: ["-evaluate", "Add", "0"], storage: "DirectClass", last: [75, 155, 195, 255] },
        { operation: ["-blur", "0x0.01"], storage: "DirectClass", last: [75, 155, 195, 255] },
        { operation: ["-gaussian-blur", "0x0.01"], storage: "DirectClass", last: [75, 155, 195, 255] },
    ])(`${mode}: solarize respects storage class after $operation`, async ({ operation, storage, last }) => {
        const files = new Map<string, Uint8Array>([["/in.png", indexed]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/in.png", indexed);
        const args = ["/in.png", ...operation, "-write", "PNG32:/before.png", "-channel", "R", "-solarize", "25700", "-write", "PNG32:/after.png", "-format", "%r", "info:"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const before = mode === "retained" ? await filesystem.readFile("/before.png") : files.get("/before.png")!;
        const after = mode === "retained" ? await filesystem.readFile("/after.png") : files.get("/after.png")!;
        expect([...decodeImage(before).data]).toEqual([...decodeImage(indexed).data]);
        expect([...decodeImage(after).data]).toEqual([20, 60, 100, 255, 75, 100, 60, 255, ...last]);
        expect(result.stdout).toContain(storage);
    });
}
