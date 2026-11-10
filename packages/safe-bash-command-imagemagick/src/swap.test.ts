import { expect, it } from "vitest";
import { createCommandArguments } from "safe-bash-contracts";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ...["1,2", "1x2", "+1,2", "+1x+2", "-2x-1"].map(spec => ({
            args: ["r.png", "g.png", "b.png", "-swap", spec], pixels: [red, blue, green]
        })),
        ...["1x9", "+1,+1", "1xbad", "++1,2"].map(spec => ({
            args: ["r.png", "g.png", "b.png", "-swap", spec], pixels: null
        })),
        { args: ["r.png", "g.png", "-swap", "0.5,1"], pixels: [green, red] },
        { args: ["r.png", "g.png", "-swap", "bad,1"], pixels: null },
        { args: ["r.png", "g.png", "b.png", "-swap", "0,9"], pixels: null },
        { args: ["r.png", "+swap"], pixels: null },
        { args: ["r.png", "g.png", "-swap", "0,0"], pixels: null },
        { args: ["r.png", "g.png", "-swap", "0,-2"], pixels: null },
        { args: ["r.png", "g.png", "-swap", "-3,0"], pixels: null },
        { args: ["r.png", "g.png", "b.png", "-swap", "0,2"], pixels: [blue, green, red] },
        { args: ["r.png", "g.png", "b.png", "-swap", "-1,0"], pixels: [blue, green, red] },
        { args: ["r.png", "g.png", "b.png", "+swap"], pixels: [red, blue, green] }
    ])(`validates image swaps in ${mode}: $args`, async ({ args, pixels }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        for (const [index, name] of ["r.png", "g.png", "b.png"].entries()) {
            const bytes = await sharp(new Uint8Array([red, green, blue][index]!), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            files.set(name, bytes);
            await filesystem.writeFile(`/${name}`, bytes);
        }
        const command = [...args, "+append", "out.png"];
        const result = mode === "sync" ? runMagickCliSync(command, files)
            : await runMagickCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if (pixels === null) {
            expect(result.exitCode).not.toBe(0);
            if (mode === "retained") await expect(filesystem.readFile("/out.png")).rejects.toThrow();
            else expect(files.has("out.png")).toBe(false);
            return;
        }
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([pixels.length, 1]);
        expect([...output.data]).toEqual(pixels.flat());
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["1x+2", [0, 3, 2, 1]],
        ["+1x+2", [0, 3, 2, 1]],
        ["1,,2", [0, 3, 2, 1]],
        ["1x2", [0, 2, 1, 3]],
        ["1,2", [0, 2, 1, 3]],
        ["1", [0, 3, 2, 1]],
        ["x2", null]
    ] as const)(`resolves four-frame swap %s in ${mode}`, async (spec, order) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const command = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", "-swap", spec, "+append", "PNG24:out.png"];
        const result = mode === "sync" ? runMagickCliSync(command, files)
            : await runMagickCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(order === null ? 1 : 0);
        if (order === null) {
            if (mode === "retained") await expect(filesystem.readFile("/out.png")).rejects.toThrow();
            else expect(files.has("out.png")).toBe(false);
            const existing = await sharp(new Uint8Array([0, 0, 0, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            files.set("out.png", existing);
            await filesystem.writeFile("/out.png", existing);
            const retry = mode === "sync" ? runMagickCliSync(command, files)
                : await runMagickCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(retry.exitCode).toBe(1);
            expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(existing);
        } else {
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect([output.width, output.height]).toEqual([4, 1]);
            expect([...output.data]).toEqual(order.flatMap(index => [red, green, blue, [255, 255, 255, 255]][index]!));
        }
    });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["0.5,1", "GRBW"], ["1.9,2", "RBGW"], ["2e0", "RGWB"],
        ["1:3", "GRBW"], ["1/2", "RBGW"], ["1x2+3+0", "RBGW"],
        ["2!", "RGWB"], ["2%", "RGWB"], ["2a", null], ["1,2", "RBGW"],
        ["+1x+2", "RWBG"], ["0.9,-1.9", "WGBR"], ["1e", null], ["1+2", null]
    ])(`parses swap geometry %s in ${mode}`, async (spec, order) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", "-swap", spec!, "+append", "PNG24:out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs: filesystem, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(order === null ? 1 : 0);
        if (order === null) {
            if (mode === "retained" || mode === "command") await expect(filesystem.readFile("/out.png")).rejects.toThrow();
            else expect(files.has("out.png")).toBe(false);
            return;
        }
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const colors = { R: red, G: green, B: blue, W: [255, 255, 255, 255] };
        expect([output.width, output.height]).toEqual([4, 1]);
        expect([...output.data]).toEqual([...order!].flatMap(color => colors[color as keyof typeof colors]));
    });
}
