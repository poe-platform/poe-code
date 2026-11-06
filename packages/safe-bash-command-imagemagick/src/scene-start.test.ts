import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "command", "sync"] as const)
for (const write of [false, true])
for (const scene of [undefined, 7])
for (const [pattern, names] of [
    ["out%02d.png", scene === undefined ? ["out00.png", "out01.png"] : ["out07.png", "out08.png"]],
    ["out.gif", scene === undefined ? ["out-0.gif", "out-1.gif"] : ["out-7.gif", "out-8.gif"]],
] as const)
it(`starts output numbering: scene=${scene}, ${mode}, write=${write}, ${pattern}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const output = pattern;
    const args = ["-size", "1x1", "xc:red", "xc:blue", "+adjoin", ...(scene === undefined ? [] : ["-scene", String(scene)]), ...(write ? ["-write", output, "null:"] : [output])];
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    } else if (mode === "sync") {
        expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0 });
    } else {
        expect(await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0 });
    }
    expect((mode === "buffered" || mode === "sync") ? [...files.keys()].sort() : (await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(names);
    for (const [index, name] of names.entries()) {
        const image = decodeImage((mode === "buffered" || mode === "sync") ? files.get(name)! : await filesystem.readFile(`/${name}`));
        expect([image.width, image.height]).toEqual([1, 1]);
        const expected = index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255];
        expect([...image.data]).toEqual(expected);
    }
});

for (const retained of [false, true])
it(`captures the scene number at each write (retained=${retained})`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const result = await runMagickCli(["-size", "1x1", "xc:red", "xc:blue", "-scene", "7", "-write", "first%02d.png", "-scene", "12", "last%02d.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(retained ? (await filesystem.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].sort()).toEqual(["first07.png", "first08.png", "last12.png", "last13.png"]);
});
