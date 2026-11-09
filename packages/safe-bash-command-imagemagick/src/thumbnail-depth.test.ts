import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: a solid, partially transparent 4x3 PNG64.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADEAYAAADkZHKFAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6MjI6NTgrMDA6MDArbWhNAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjIyOjU4KzAwOjAwWjDQ8QAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjoyMjo1OCswMDowMA0l8S4AAAAaSURBVAjXY3RNV3ZdfXbGagYcgImBACCoAABmcwPVBSUfPQAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["-thumbnail", "8x6", 8, 6],
        ["-thumbnail", "2x2!", 2, 2],
        ["-thumbnail", "4x3", 4, 3],
        ["-sample", "8x6", 8, 6],
        [undefined, undefined, 4, 3]
    ] as const)(`preserves full RGBA16 samples with %s %s (${mode})`, async (operation, geometry, width, height) => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...(operation ? [operation, geometry!] : []), "PNG64:/out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await filesystem.readFile("/out.png");
        expect(bytes[24]).toBe(16);
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([width, height]);
        expect(Array.from(image.data16!)).toEqual(Array.from({ length: width * height }, () => [0x4567, 0x2345, 0xabcd, 0x98ab]).flat());
    });
}
