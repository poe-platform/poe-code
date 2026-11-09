import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// 8-bit RGBA PNG, 8x6 with virtual page 25x19-5-3.
const source = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MDQ6NTgrMDA6MDAfUTcDAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjA0OjU4KzAwOjAwbgyPvwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzowNDo1OCswMDowMDkZrmAAAAAQY2FOdgAAABkAAAAT////+/////2qATKzAAAAMklEQVQI12NmUPXKX7rj1N0fXLLrT919zyS7/tCV90wiyw9def5TZPnOM0waBMBgUAAAycsrGr6PfHgAAAAASUVORK5CYII=", "base64"));

for (const mode of ["buffered", "retained", "sync", "command"]) for (const operation of ["inspect", "splice"]) {
    it(`preserves native HSV ${operation} results via ${mode}`, async () => {
        for (const space of ["HSV", "hSv", "HSB"]) {
            const files = new Map([["rgba.png", source]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/rgba.png", source);
            const args = ["rgba.png", "-colorspace", space, ...(operation === "inspect"
                ? ["-format", "%[colorspace]|%[pixel:p{0,0}]", "info:"]
                : ["-background", "#ef218b80", "-splice", "3x2+2+1", "-colorspace", "sRGB", "PNG32:out.png"])];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", ...createCommandArguments(args), cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
            if (operation === "inspect") {
                expect(("stdout" in result ? result.stdout : stdout).trim()).toBe(`${space.toUpperCase()}|${space.toLowerCase()}a(210,100%,29.0196%,0.435294)`);
                continue;
            }
            const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([output.width, output.height]).toEqual([11, 8]);
            expect([...output.data.slice(8, 12)]).toEqual([139, 121, 128, 128]);
            expect([...output.data.slice(0, 4)]).toEqual([0, 37, 74, 111]);
        }
    });
}
