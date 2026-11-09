import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves these opaque overlay samples exactly.
const base = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NTA6MTUrMDA6MDA/ujjPAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjUwOjE1KzAwOjAwTueAcwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo1MDoxNSswMDowMBnyoawAAAARSURBVAjXY2Tl5P1f4SvHAAAIxQH/LIQIRgAAAABJRU5ErkJggg==", "base64");
const top = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NTA6MTUrMDA6MDA/ujjPAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjUwOjE1KzAwOjAwTueAcwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo1MDoxNSswMDowMBnyoawAAAAaSURBVAjXY5jjeNzyk+H//8qa8o7Skf//AwBEcQgdia8s8gAAAABJRU5ErkJggg==", "base64");
const top8 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NTA6MTUrMDA6MDA/ujjPAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjUwOjE1KzAwOjAwTueAcwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo1MDoxNSswMDowMBnyoawAAAARSURBVAjXY5hz7ON/ZXnp/wAXEgSvr2iOBwAAAABJRU5ErkJggg==", "base64");

const translucent = decodeImage(top);
translucent.data16![3] = 32768;
translucent.data16![7] = 0;
const translucentTop = encodeImage(translucent, { format: "png" }).data;

for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const standalone of [false, true])
it.each([
    { name: "16-bit overlay", overlay: top, settings: [], expected: [40001, 51001, 62001, 65535, 9001, 8001, 7001, 65535] },
    { name: "8-bit control", overlay: top8, settings: [], expected: [40092, 50886, 61937, 65535, 8995, 7967, 6939, 65535] },
    { name: "positive offset", overlay: top, settings: ["-geometry", "+1+0"], expected: [1285, 2313, 3341, 65535, 40001, 51001, 62001, 65535] },
    { name: "negative offset", overlay: top, settings: ["-geometry", "-1+0"], expected: [9001, 8001, 7001, 65535, 32125, 22102, 11051, 65535] },
    { name: "partial and zero alpha", overlay: translucentTop, settings: [], expected: [20643, 26657, 32671, 65535, 32125, 22102, 11051, 65535] }
])(`${route}, standalone=${standalone}: preserves precision on an 8-bit base ($name)`, async ({ overlay, settings, expected }) => {
    const files = new Map<string, Uint8Array>([["/base.png", base], ["/top.png", overlay]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = standalone ? ["composite", ...settings, "/top.png", "/base.png", "PNG64:/out.png"]
        : ["/base.png", "/top.png", ...settings, "-composite", "PNG64:/out.png"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = decodeImage(route === "command" || route === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([2, 1]);
    expect([...output.data16!]).toEqual(expected);
});
