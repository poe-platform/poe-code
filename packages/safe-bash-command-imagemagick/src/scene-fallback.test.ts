import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "command", "sync"] as const)
for (const write of [false, true])
for (const [pattern, name, scene, single] of [
    ["v%Q.gif", "v%Q-0.gif", 0, false],
    ["v%03X.gif", "v%03X-15.gif", 15, false],
    ["v%%.gif", "v%.gif", 0, false],
    ["out.gif", "out.gif", 0, false],
    ["v%Q.png", "v%Q.png", 0, true],
] as const)
it(`uses joined scene fallback: ${mode}, write=${write}, ${pattern}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["-size", "1x1", "-delay", "4", "xc:red", ...(single ? [] : ["-delay", "8", "xc:lime", "-delay", "12", "xc:blue"]), "-scene", String(scene), ...(write ? ["-write", pattern, "null:"] : [pattern])];
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    } else if (mode === "sync") {
        expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0 });
    } else {
        expect(await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0 });
    }
    const buffered = mode === "buffered" || mode === "sync";
    expect(buffered ? [...files.keys()] : (await filesystem.readdir("/")).map(entry => entry.name)).toEqual([name]);
    const image = decodeImage(buffered ? files.get(name)! : await filesystem.readFile(`/${name}`), { animated: true });
    expect([...image.data]).toEqual(single ? [255, 0, 0, 255] : [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    if (!single) expect(image.delay).toEqual([40, 80, 120]);
});
