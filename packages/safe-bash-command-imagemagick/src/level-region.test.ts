import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Original issue attachment; full RGBA8 reference from ImageMagick 7.1.2-31 Q16-HDRI,
// writing PNG32 then decoding with -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAACCAYAAABllJ3tAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MjY6NTIrMDA6MDBVqnujAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjI2OjUyKzAwOjAwJPfDHwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjoyNjo1MiswMDowMHPi4sAAAAA+SURBVAjXPcohDsBACARA1uHAkpMgMA1qH8gj+58TTSonGYjI4+6cGQIgAGYmzzmfd/etKkbEH1SV3U0z4wUJ2whoSKOnWgAAAABJRU5ErkJggg==", "base64");
const cases = [
    {
        name: "regional",
        options: ["-region", "4x1+1+0", "-level", "25%,75%"],
        expected: [
            5, 5, 5, 45, 0, 0, 0, 69, 0, 0, 0, 175, 1, 1, 1, 255, 3, 3, 3, 0, 6, 6, 6, 54, 52, 52, 52, 107, 100, 100, 100, 160,
            129, 129, 129, 213, 0, 0, 0, 10, 20, 20, 20, 63, 101, 101, 101, 116, 176, 176, 176, 169, 214, 214, 214, 222, 0, 0, 0, 19, 44, 44, 44, 72,
        ],
    },
    {
        name: "unmasked",
        options: ["-level", "25%,75%"],
        expected: [
            0, 0, 0, 0, 0, 0, 0, 69, 0, 0, 0, 175, 1, 1, 1, 255, 3, 3, 3, 0, 73, 73, 73, 0, 127, 127, 127, 87, 129, 129, 129, 193,
            131, 131, 131, 255, 203, 203, 203, 0, 253, 253, 253, 0, 255, 255, 255, 105, 255, 255, 255, 211, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 17,
        ],
    },
    {
        name: "RGB region",
        options: ["-channel", "RGB", "-region", "4x1+1+0", "-level", "25%,75%"],
        expected: [
            0, 0, 0, 45, 0, 0, 0, 98, 0, 0, 0, 151, 1, 1, 1, 204, 3, 3, 3, 1, 13, 13, 13, 54, 56, 56, 56, 107, 95, 95, 95, 160,
            122, 122, 122, 213, 1, 1, 1, 10, 41, 41, 41, 63, 105, 105, 105, 116, 164, 164, 164, 169, 201, 201, 201, 222, 6, 6, 6, 19, 73, 73, 73, 72,
        ],
    },
    {
        name: "disabled alpha region",
        options: ["-alpha", "off", "-region", "4x1+1+0", "-level", "25%,75%"],
        expected: [
            0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 1, 1, 1, 255, 3, 3, 3, 255, 100, 100, 100, 255, 127, 127, 127, 255, 128, 128, 128, 255,
            129, 129, 129, 255, 165, 165, 165, 255, 190, 190, 190, 255, 191, 191, 191, 255, 192, 192, 192, 255, 200, 200, 200, 255, 240, 240, 240, 255, 255, 255, 255, 255,
        ],
    },
    {
        name: "inverse region",
        options: ["-region", "4x1+1+0", "+level", "25%,75%"],
        expected: [
            18, 18, 18, 45, 72, 72, 72, 113, 95, 95, 95, 139, 96, 96, 96, 166, 96, 96, 96, 64, 53, 53, 53, 54, 87, 87, 87, 107, 107, 107, 107, 160,
            122, 122, 122, 213, 44, 44, 44, 10, 92, 92, 92, 63, 128, 128, 128, 116, 159, 159, 159, 169, 189, 189, 189, 222, 67, 67, 67, 19, 126, 126, 126, 72,
        ],
    },
    {
        name: "clipped region",
        options: ["-region", "4x2-1+1", "-level", "25%,75%"],
        expected: [
            5, 5, 5, 45, 0, 0, 0, 98, 31, 31, 31, 151, 49, 49, 49, 204, 0, 0, 0, 1, 6, 6, 6, 54, 52, 52, 52, 107, 100, 100, 100, 160,
            131, 131, 131, 255, 203, 203, 203, 0, 253, 253, 253, 0, 101, 101, 101, 116, 176, 176, 176, 169, 214, 214, 214, 222, 0, 0, 0, 19, 44, 44, 44, 72,
        ],
    },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches every native level pixel with translucent input: $name (${mode})`, async ({ options, expected }) => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...options, "+region", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([8, 2]);
        expect([...output.data]).toEqual(expected);
    });
}
