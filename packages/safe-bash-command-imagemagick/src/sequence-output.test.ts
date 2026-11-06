import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"] as const)
for (const format of ["png", "jpeg", "bmp"])
for (const write of [false, true])
for (const numbered of [false, true])
it(`preserves sequence frames: ${mode}, ${format}, write=${write}, numbered=${numbered}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const output = `out${numbered ? "%02d" : ""}.${format}`;
    const args = ["-size", "1x1", "xc:red", "xc:blue", ...(write ? ["-write", output, "null:"] : [output])];
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    } else {
        expect(await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0 });
    }
    const names = [0, 1].map(index => `out${numbered ? String(index).padStart(2, "0") : `-${index}`}.${format}`);
    expect(mode === "buffered" ? [...files.keys()].sort() : (await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(names);
    for (const [index, name] of names.entries()) {
        const image = decodeImage(mode === "buffered" ? files.get(name)! : await filesystem.readFile(`/${name}`));
        expect([image.width, image.height]).toEqual([1, 1]);
        const expected = index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255];
        for (const [channel, value] of expected.entries()) expect(Math.abs(image.data[channel]! - value)).toBeLessThanOrEqual(format === "jpeg" ? 2 : 0);
    }
});
