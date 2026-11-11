import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "command", "sync"] as const)
for (const write of [false, true])
for (const [pattern, names, single = false, split = false] of [
    ["frame%%d.gif", ["frame%d.gif"]],
    ["frame%%.gif", ["frame%.gif"]],
    ["frame%%%%d.gif", ["frame%%d.gif"]],
    ["frame%%.png", ["frame%.png"], true],
    ["frame%%d.png", ["frame%d.png"], true],
    ["frame%%.png", ["frame%.png"]],
    ["frame%%d.png", ["frame%d.png"]],
    ["frame%%.png", ["frame%.png"], false, true],
    ["frame%%d.png", ["frame%d.png"], false, true],
    ["frame%%%%d.png", ["frame%%d.png"], false, true],
    ["frame%%-%02d.png", ["frame%-00.png", "frame%-01.png"], false, true],
    ["frame.png", ["frame-0.png", "frame-1.png"], false, true],
    ["frame%%%02d.gif", ["frame%00.gif", "frame%01.gif"]],
    ["frame%02d.gif", ["frame00.gif", "frame01.gif"]],
] as const)
it(`expands percent destinations: ${mode}, write=${write}, split=${split}, single=${single}, ${pattern}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const output = pattern;
    const args = ["-size", "1x1", "xc:red", ...(single ? [] : ["xc:blue"]), ...(split ? ["+adjoin"] : []), ...(write ? ["-write", output, "null:"] : [output])];
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    } else if (mode === "sync") {
        expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0 });
    } else {
        expect(await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0 });
    }
    expect((mode === "buffered" || mode === "sync") ? [...files.keys()].sort() : (await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual([...names].sort());
    for (const [index, name] of names.entries()) {
        const image = decodeImage((mode === "buffered" || mode === "sync") ? files.get(name)! : await filesystem.readFile(`/${name}`));
        expect([image.width, image.height]).toEqual([1, 1]);
        const overwritten = pattern.endsWith(".png") && !single && names.length === 1;
        const expected = index === 0 && !overwritten ? [255, 0, 0, 255] : [0, 0, 255, 255];
        expect([...image.data]).toEqual(expected);
        if (pattern.endsWith(".gif")) {
            const bytes = (mode === "buffered" || mode === "sync") ? files.get(name)! : await filesystem.readFile(`/${name}`);
            expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(names.length === 1 ? 2 : 1);
            if (names.length === 1) expect([...await sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer()]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
        }
    }
});

for (const retained of [false, true])
for (const command of ["compare", "montage"])
it(`unescapes ${command} output once (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const input = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli(["-size", "1x1", "xc:red", "in.png"], input)).toMatchObject({ exitCode: 0 });
    expect(await runMagickCli([command, "in.png", "in.png", "frame%%%%d.png"], input)).toMatchObject({ exitCode: 0 });
    const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()];
    expect(names.sort()).toEqual(["frame%%d.png", "in.png"]);
});
