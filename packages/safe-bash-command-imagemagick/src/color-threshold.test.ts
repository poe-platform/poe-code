import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

it.each(["+color-threshold", "-color-threshold"])("matches native gray stdout for %s", async option => {
    const args = createCommandArguments(["xc:red", option, "red-red", "-depth", "8", "gray:-"]).args;
    const stdout: number[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(option === "+color-threshold" ? 1 : 0);
    expect(stdout).toEqual(option === "+color-threshold" ? [] : [255]);
    expect(stderr).toBe(option === "+color-threshold" ? "magick: option deprecated, unable to execute '+color-threshold' at CLI arg 2\n" : "");
});

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAABCAYAAADjAO9DAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MTM6NTgrMDA6MDCOEYmoAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjEzOjU4KzAwOjAw/0wxFAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjoxMzo1OCswMDowMKhZEMsAAAAkSURBVAjXBcEBEQAgEAMg1sSmf0YzkTaYkNIUqRHBrEU49+0PiOIIYgiOdHkAAAAASUVORK5CYII=", "base64");
// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded PNG32 RGBA output.
for (const mode of ["buffered", "sync", "retained", "command", "mogrify"] as const) {
    it.each([
        ["#800000-#ff2020", [], [0, 4, 5]],
        ["#80000000-#ff2020ff", [], [0, 4, 5, 7]],
        ["#008000-#20ff20", [], [1]],
        ["#000080-#2020ff", [], [2]],
        ["#ff2020-#800000", [], []],
        ["red-red", [], [0]],
        ["rgb(128,0,0)-rgb(255,32,32)", [], [0, 4, 5]],
        ["#800000-#ff2020", ["-channel", "R"], [0, 4, 5, 6, 7]],
        ["#800000-#ff2020", ["-channel", "RGB"], [0, 4, 5, 7]],
        ["#800000-#ff2020", ["-channel", "A"], [0, 1, 2, 3, 4, 5, 6]],
    ] satisfies [string, string[], number[]][])(`${mode}: selects inclusive color range %s %j`, async (range, settings, white) => {
        const files = new Map([["input.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const args = ["input.png", ...settings, "-color-threshold", range, "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...settings, "-color-threshold", range, "input.png"], { filesystem: fs, cwd: "/" })
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("out.png")!
            : await fs.readFile(mode === "mogrify" ? "/input.png" : "/out.png");
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([8, 1]);
        expect([...image.data]).toEqual(Array.from({ length: 8 }, (_, x) => {
            const value = white.includes(x) ? 255 : 0;
            return [value, value, value, 255];
        }).flat());
    });
}

for (const mode of ["sync", "retained"] as const) {
    it(`compares 16-bit endpoint boundaries without rounding (${mode})`, async () => {
        const data16 = Uint16Array.from([32767, 0, 0, 65535, 32768, 0, 0, 65535, 32769, 0, 0, 65535]);
        const png = encodeImage({ width: 3, height: 1, data: Uint8Array.from(data16, value => Math.round(value / 257)), data16,
            format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["input.png", png]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", png);
        const args = ["input.png", "-color-threshold", "#800000000000-#800000000000", "PNG64:out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png"));
        expect([...image.data16!]).toEqual([0, 0, 0, 65535, 65535, 65535, 65535, 65535, 0, 0, 0, 65535]);
    });
}
