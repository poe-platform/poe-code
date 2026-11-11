import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

it.each(["sync", "buffered", "retained"] as const)("writes and reads ICO bitmap dimensions above 256 (%s)", async mode => {
    for (const [width, height] of [[256, 16], [257, 16], [300, 16], [16, 257], [512, 512]] as const) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files) : runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(await run(["-size", `${width}x${height}`, "xc:red", "large.ico"])).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile("/large.ico") : files.get("large.ico")!;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = view.getUint32(18, true);
        expect([...bytes.slice(6, 8)]).toEqual([width % 256, height % 256]);
        expect([view.getInt32(offset + 4, true), view.getInt32(offset + 8, true)]).toEqual([width, height * 2]);
        expect(readImageMetadata(bytes)).toMatchObject({ width, height });
        const image = decodeImage(bytes);
        expect([...image.data.slice(-4)]).toEqual([255, 0, 0, 255]);
        expect(await run(["large.ico", "readback.png"])).toMatchObject({ exitCode: 0, stderr: "" });
        const readback = decodeImage(mode === "retained" ? await filesystem.readFile("/readback.png") : files.get("readback.png")!);
        expect(readback).toMatchObject({ width, height });
        expect(Buffer.from(readback.data).equals(image.data)).toBe(true);
    }
});

it.each(["sync", "buffered", "retained"] as const)("auto-resizes ICO entries above 256 in requested order (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files) : runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(await run(["-size", "32x32", "xc:red", "-define", "icon:auto-resize=257,300,512,16", "large.ico"])).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await run(["large.ico", "readback-%d.png"])).toMatchObject({ exitCode: 0, stderr: "" });
    for (const [index, size] of [257, 300, 512, 16].entries()) {
        const path = `readback-${index}.png`;
        const image = decodeImage(mode === "retained" ? await filesystem.readFile(`/${path}`) : files.get(path)!);
        expect(image).toMatchObject({ width: size, height: size });
        expect([...image.data.slice(-4)]).toEqual([255, 0, 0, 255]);
    }
});

it.each(["sync", "buffered", "retained"] as const)("rejects ICO dimensions above the native 512 limit without replacing output (%s)", async mode => {
    for (const dimensions of ["513x16", "16x513"]) {
        const original = Uint8Array.of(1, 2, 3), files = new Map([["large.ico", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/large.ico", original);
        const args = ["-size", dimensions, "xc:red", "large.ico"];
        if (mode === "retained") await expect(runConvertCli(args, { filesystem, cwd: "/" })).rejects.toThrow("ICO dimensions");
        else expect((mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files)).exitCode).toBe(1);
        expect(mode === "retained" ? await filesystem.readFile("/large.ico") : files.get("large.ico")).toEqual(original);
    }
});
