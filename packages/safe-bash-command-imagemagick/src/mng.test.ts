import { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

it.each(["sync", "buffered", "retained"] as const)("writes one MNG with ordered frames (%s)", async mode => {
    for (const destination of ["out.mng", "MNG:out.png", "MNG:-"]) {
        for (const intermediate of [false, true]) {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const source = runConvertCliSync(["-size", "2x2", "-delay", "20", "xc:red", "-delay", "40", "xc:lime", "-delay", "20", "xc:blue", "-loop", "2", "input.gif"], files);
            expect(source.exitCode).toBe(0);
            await fs.writeFile("/input.gif", files.get("input.gif")!);
            const args = ["input.gif", ...(intermediate ? ["-write", destination, "null:"] : [destination])];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const path = destination === "out.mng" ? "out.mng" : "out.png";
            const bytes = destination.endsWith(":-") ? result.stdoutBytes : mode === "retained" ? await fs.readFile(`/${path}`) : files.get(path);
            expect(bytes).toBeDefined();
            expect([...bytes!.slice(0, 8)]).toEqual([138, 77, 78, 71, 13, 10, 26, 10]);
            const frames: Uint8Array[][] = [];
            const delays: number[] = [];
            for (let offset = 8; offset < bytes!.length;) {
                const length = new DataView(bytes!.buffer, bytes!.byteOffset + offset, 4).getUint32(0);
                const type = new TextDecoder().decode(bytes!.subarray(offset + 4, offset + 8));
                const data = new DataView(bytes!.buffer, bytes!.byteOffset + offset + 8, length);
                if (type === "MHDR") expect([data.getUint32(0), data.getUint32(4), data.getUint32(8), data.getUint32(16)]).toEqual([2, 2, 1000, 3]);
                if (type === "TERM") expect(data.getUint32(6)).toBe(2);
                if (type === "FRAM") delays.push(data.getUint32(6));
                if (type === "IHDR") frames.push([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]);
                if (["IHDR", "IDAT", "IEND"].includes(type)) frames.at(-1)!.push(bytes!.slice(offset, offset + length + 12));
                offset += length + 12;
            }
            expect(delays).toEqual([200, 400, 200]);
            expect(frames.map(parts => [...decodeImage(Uint8Array.from(parts.flatMap(part => [...part]))).data.slice(0, 4)])).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
            expect([...files.keys()].some(name => name.includes("out-"))).toBe(false);
            expect((await fs.readdir("/")).some(entry => entry.name.includes("out-"))).toBe(false);
        }
    }
});

it.each(["sync", "buffered", "retained"] as const)("keeps explicit scene splitting and single frames (%s)", async mode => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    for (const output of [["+adjoin", "split.mng"], ["scene-%d.mng"], ["single.mng"]]) {
        const args = ["-size", "1x1", "xc:red", ...(output[0] === "single.mng" ? [] : ["xc:blue"]), ...output];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const paths = output[0] === "single.mng" ? ["single.mng"] : output[0] === "+adjoin" ? ["split-0.mng", "split-1.mng"] : ["scene-0.mng", "scene-1.mng"];
        for (const path of paths) {
            const bytes = mode === "retained" ? await fs.readFile(`/${path}`) : files.get(path)!;
            expect([...bytes.slice(0, 8)]).toEqual([138, 77, 78, 71, 13, 10, 26, 10]);
            expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(32)).toBe(1);
        }
    }
});
