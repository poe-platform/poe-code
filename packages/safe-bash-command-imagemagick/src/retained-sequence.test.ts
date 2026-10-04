import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCli } from "./index.js";

const operations = [
    ...["Mean", "Average", "Median", "Min", "Max", "Add", "Multiply", "unknown", "m-e_a-n"].map(op => ["-evaluate-sequence", op]),
    ["-clut"], ["-channel", "RA", "-hald-clut"], ["-combine"], ["-channel", "RGBA", "-separate", "-combine"], ["-separate", "-append"], ["-morph", "2", "-append"]
];
for (const operation of operations)
for (const magick of [false, true])
it(`retains ${operation.join(" ")} via ${magick ? "magick" : "convert"}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    for (let frame = 0; frame < 4; frame++) {
        const width = frame % 2 ? 11 : 13, height = 7 + frame;
        const bytes = await sharp(Uint8Array.from({ length: width * height * 4 }, (_, index) => (index * 73 + frame * 31) % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
        files.set("f" + frame, bytes); await fs.writeFile("/f" + frame, bytes);
    }
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file sequence I/O forbidden"); };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = ["f0", "f1", "f2", "f3", ...operation, "out.png"], expected = await runConvertCli(args, files);
    expect(expected.exitCode).toBe(0);
    expect(await (magick ? runMagickCli : runConvertCli)(magick ? ["convert", ...args] : args, { filesystem, cwd: "/" })).toEqual(expected);
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["f0", "f1", "f2", "f3", "out.png"]);
});

it("preserves stable median ordering after frame metadata eviction", async () => {
    const fs = new MemoryFileSystem(), args: string[] = [];
    for (let frame = 0; frame < 141; frame++) {
        const bytes = await sharp(Uint8Array.of(frame, 255 - frame, 0, 19), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        await fs.writeFile("/f" + frame, bytes); args.push("f" + frame);
    }
    const result = await runConvertCli([...args, "-evaluate-sequence", "Median", "out.png"], { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(decodeImage(await fs.readFile("/out.png")).data).toEqual(Uint8Array.of(70, 185, 0, 19));
    expect((await fs.readdir("/")).length).toBe(142);
});

it("cancels sequence output before publication and removes caller scratch", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 271, height: 277, channels: 3, background: "red" } }).png().toBuffer(), controller = new AbortController(), failure = new Error("cancel sequence");
    await fs.writeFile("/input", bytes); await fs.writeFile("/output.png", new TextEncoder().encode("previous"));
    let writes = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
            const handle = await fs.open(...args);
            return new Proxy(handle, { get(target, key) {
                if (key === "write") return async (...args: Parameters<typeof handle.write>) => { const written = await handle.write(...args); if (++writes === 8) controller.abort(failure); return written; };
                const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
            } });
        };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runConvertCli(["input", "+clone", "-morph", "3", "-evaluate-sequence", "Median", "output.png"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(failure);
    expect(new TextDecoder().decode(await fs.readFile("/output.png"))).toBe("previous");
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input", "output.png"]);
});
