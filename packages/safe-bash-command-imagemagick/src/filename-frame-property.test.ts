import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const write of [false, true])
for (const extension of ["png", "gif"])
for (const [value, names] of [
    ["%s", ["frame0.png", "frame1.png", "frame2.png"]],
    ["%s-%w-%h", ["frame0-2-1.png", "frame1-2-1.png", "frame2-2-1.png"]],
    ["still", ["framestill.png"]],
    ["%%s", ["frame%s.png"]],
    ["%s-%%d", ["frame0-%d.png", "frame1-%d.png", "frame2-%d.png"]],
] as const)
it(`evaluates filename property ${value} per frame in ${mode}, write=${write}, ${extension}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    expect(runConvertCliSync(["-size", "2x1", "-delay", "4", "xc:red", "-delay", "8", "xc:lime", "-delay", "12", "xc:blue", "in.gif"], files).exitCode).toBe(0);
    await filesystem.writeFile("/in.gif", files.get("in.gif")!);
    const output = `frame%[filename:key].${extension}`;
    const expectedNames = names.map(name => name.replace(".png", `.${extension}`));
    const args = ["in.gif", "-set", "filename:key", value, ...(write ? ["-write", output, "null:"] : [output])];
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        let stderr = "";
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } } } as CommandContext)).toEqual({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    }
    const buffered = mode === "buffered" || mode === "sync";
    expect((buffered ? [...files.keys()] : (await filesystem.readdir("/")).map(entry => entry.name)).sort()).toEqual(["in.gif", ...expectedNames].sort());
    for (const [index, name] of expectedNames.entries()) {
        const image = decodeImage(buffered ? files.get(name)! : await filesystem.readFile(`/${name}`));
        expect([image.width, image.height]).toEqual([2, 1]);
        const color = names.length === 1 ? [0, 0, 255, 255] : [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]][index]!;
        expect([...image.data]).toEqual([...color, ...color]);
    }
});
