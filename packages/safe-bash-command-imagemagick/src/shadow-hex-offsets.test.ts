import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 PNG32: 3x2, alpha 0/51/102/153/204/255, page 11x9+4+3.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6NDc6MTcrMDA6MDBX8xdZAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjQ3OjE3KzAwOjAwJq6v5QAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjo0NzoxNyswMDowMHG7jjoAAAAQY2FOdgAAAAsAAAAJAAAABAAAAAN01dkuAAAAHElEQVQI12O80+TGwMDAYMzAwGDMwsDAMBPGAQA1UQMPA3NT9QAAAABJRU5ErkJggg==", "base64");

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["80x0+2+1", "80x0+0x2+0x1", "80x0+0X2+1", "80x0+2+0x1"])(`preserves unblurred shadow pixels and page with %s (${mode})`, async geometry => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-background", "#204060", "-shadow", geometry, "PNG32:/out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([3, 2]);
        expect(output.virtualCanvas).toEqual({ width: 13, height: 10, x: 6, y: 4 });
        // Full RGBA8 output from native ImageMagick, including RGB beneath zero alpha.
        expect(output.data).toEqual(Uint8Array.from([0, 41, 82, 122, 163, 204].flatMap(alpha => [32, 64, 96, alpha])));
    });
}
