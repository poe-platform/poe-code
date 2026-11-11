import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "command", "sync"] as const)
for (const write of [false, true])
for (const [pattern, names, scene = 0] of [
    ["z%03d.png", ["z-01.png", "z000.png"], -1],
    ["z%3d.png", ["z -1.png", "z  0.png"], -1],
    ["z%d.png", ["z-1.png", "z0.png"], -1],
    ["z%02d-f%02d.png", ["z00-f00.png", "z01-f01.png"]],
    ["z%d-f%d.png", ["z0-f0.png", "z1-f1.png"]],
    ["z%02d-%%.png", ["z00-%.png", "z01-%.png"]],
    ["z%%-%02d.png", ["z%-00.png", "z%-01.png"]],
    ["z%%d-%d-%02d.png", ["z%d-0-00.png", "z%d-1-01.png"]],
    ["v%03x.gif", ["v00f.gif", "v010.gif", "v011.gif"], 15],
    ["v%03o.gif", ["v017.gif", "v020.gif", "v021.gif"], 15],
    ["v%03d.gif", ["v015.gif", "v016.gif", "v017.gif"], 15],
    ["v%x-%o.gif", ["vf-17.gif", "v10-20.gif", "v11-21.gif"], 15],
    ["v%3x.gif", ["v  f.gif", "v 10.gif", "v 11.gif"], 15],
] as const)
it(`formats every scene field: ${mode}, write=${write}, ${pattern}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const output = pattern;
    const args = ["-size", "1x1", "xc:red", ...(scene === 15 ? ["xc:lime"] : []), "xc:blue", "-scene", String(scene), ...(write ? ["-write", output, "null:"] : [output])];
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
        const expected = index === 0 ? [255, 0, 0, 255] : scene === 15 && index === 1 ? [0, 255, 0, 255] : [0, 0, 255, 255];
        expect([...image.data]).toEqual(expected);
    }
});
