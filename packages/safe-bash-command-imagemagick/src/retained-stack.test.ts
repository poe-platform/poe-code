import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { StoredImageStack, magickInput } from "./stored-stack.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const pipelines = [
    ["first", "-duplicate", "140", "-write", "frame-%03d.png", "-delete", "0-139", "-negate", "-write", "frame-000.png", "-remap", "frame-140.png"],

    ["first", "second", "-swap", "0.5,1"],
    ["first", "second", "-swap", "bad,1"],
    ["first", "second", "-write", "frame-%02d.png", "-delete", "1"],

    ["-size", "19x13", "tile:animated.gif", "-delete", "0"],
    ["-size", "19x13", "tile:animated.gif[1,0]", "-delete", "1"],
    ["first", "second", "-gravity", "center", "-geometry", "5x7+2-1", "-composite"],

    ["-size", "23x17", "xc:red", "label:Test"],
    ...["over", "multiply", "screen", "dissolve", "blend", "copy", "clear", "copyalpha", "difference", "srcin", "srcout", "dstin", "dstout", "atop", "xor", "plus"].map(mode => ["first", "second", "-compose", mode, "-define", "compose:args=33x67", "-composite"]),
    ...["northwest", "center", "southeast"].flatMap(gravity => ["-append", "+append"].map(operation => ["first", "second", "-gravity", gravity, operation])),

    [...Array.from({ length: 45 }, (_, i) => i % 2 ? "first" : "second"), "-reverse", "-delete", "1-43", "-fx", "(u+v)/2"],
    ["first", "second", "-duplicate", "2,0-1", "-delete", "0-4"],
    ["first", "second", "+insert"],
    ["first", "second", "-insert", "-2"],
    ["first", "second", "-write", "middle.png", "-delete", "1"],
    ["first", "-duplicate", "40", "-reverse", "-delete", "1-39", "-fx", "u[1].w/w*u"],
    ["animated.gif[1,0]", "-resize", "9x7!", "-append"],
    ["first", "(", "second", "(", "+clone", "-negate", ")", "-reverse", ")", "-delete", "1"],
    ["first", "(", "+clone", "-negate"],
    ["first", "(", "--", "second", ")", "-delete", "1"],

    ["first", "second", "-flip"],
    ["first", "-negate", "second", "-flop"],
    ["first", "second", "-swap", "0,1"],
    ["first", "second", "-delete", "1"],
    ["first", "+clone", "-negate", "-delete", "0"],
    ["first", "second", "-clone", "0", "-flip"],
    ["first", "-duplicate", "3", "-delete", "0-2"],
    ["first", "second", "-reverse"],
    ["first", "(", "second", "-negate", ")", "-swap", "0,1"],
    ["first", "(", "+clone", "-negate", ")", "-delete", "0"],
    ["animated.gif", "-delete", "1"],
    ["animated.gif[1,0]", "-delete", "1"],
    ["first", "second", "-fx", "(u+v)/2"],
    ["first", "second", "-append"],
    ["first", "second", "+append"],
    ["first", "second", "-compose", "multiply", "-composite"],
    ["first", "second", "-flatten"]
];
it.each(pipelines.map(args => ({ args })))("retains stack $args", async ({ args }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const [name, width, height] of [["first", 13, 17], ["second", 7, 11]] as const) {
        files.set(name, await sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer());
    }
    expect((await runConvertCli(["-size", "7x5", "xc:red", "xc:blue", "animated.gif"], files)).exitCode).toBe(0);
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file stack I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = [...args, "out.png"], expected = await runConvertCli(argv, files);
    expect(expected.exitCode).toBe(0);
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(expected);
    for (const [path, bytes] of files) if (path.startsWith("frame-")) expect(decodeImage(await fs.readFile("/" + path))).toEqual(decodeImage(bytes));
    if (files.has("middle.png")) expect(decodeImage(await fs.readFile("/middle.png"))).toEqual(decodeImage(files.get("middle.png")!));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});

it("restores evicted frame metadata and caller-backed delays across nested stacks", async () => {
    const fs = new MemoryFileSystem(), signal = new AbortController().signal;
    const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal }, 1);
    const stack = new StoredImageStack(storage, signal), nested = new StoredImageStack(storage, signal, stack);
    try {
        for (let i = 0; i < 70; i++) {
            await (i % 2 ? stack : nested).push({ position: i * 4, width: 1, height: 1, channels: 4, format: "gif", depth: "uchar", space: "srgb", hasAlpha: true, density: 72,
                storedDelay: { length: 1025, async at(index) { return index === 513 ? undefined : index === 514 ? NaN : index + i; } },
                [magickInput]: { filePath: "images/😀/" + i, sceneIdx: i }
            });
        }
        for (const source of [stack, nested]) for (let n = 0; n < source.length; n++) {
            const image = (await source.get(n))!, scene = image[magickInput]!.sceneIdx!;
            expect(image.position).toBe(scene * 4);
            expect(image[magickInput]!.filePath).toBe("images/😀/" + scene);
            expect(await image.storedDelay!.at(512)).toBe(512 + scene);
            expect(await image.storedDelay!.at(513)).toBeUndefined();
            expect(await image.storedDelay!.at(514)).toBeNaN();
            expect(await image.storedDelay!.at(1024)).toBe(1024 + scene);
        }
    } finally { await storage.close(); }
    expect(await fs.readdir("/")).toEqual([]);
});

it("publishes completed intermediate writes when the final stack is empty", async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["-size", "3x2", "xc:red", "-write", "middle.png", "+delete", "out.png"];
    const expected = await runConvertCli(args, files);
    expect(expected.exitCode).toBe(1);
    expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(expected);
    expect(decodeImage(await fs.readFile("/middle.png"))).toEqual(decodeImage(files.get("middle.png")!));
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["middle.png"]);
});
