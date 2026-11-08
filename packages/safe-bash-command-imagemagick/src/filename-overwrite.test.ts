import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const write of [false, true])
for (const extension of ["png", "gif"])
it(`overwrites a shared filename-property ${extension} path in ${mode}, write=${write}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const output = `v%[filename:key].${extension}`;
    expect(runConvertCliSync(["-size", "2x1", "-delay", "4", "xc:red", "-delay", "8", "xc:lime", "-delay", "12", "xc:blue", "in.gif"], files).exitCode).toBe(0);
    await filesystem.writeFile("/in.gif", files.get("in.gif")!);
    const args = ["in.gif",
        "-set", "filename:key", "still", ...(write ? ["-write", output, "null:"] : [output])];
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        let stderr = "";
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } } } as CommandContext)).toEqual({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    }
    const retained = mode === "retained" || mode === "command";
    const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()];
    expect(names.sort()).toEqual(["in.gif", `vstill.${extension}`]);
    const bytes = retained ? await filesystem.readFile(`/vstill.${extension}`) : files.get(`vstill.${extension}`)!;
    const image = decodeImage(bytes, { animated: true });
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(image.pages ?? 1).toBe(1);
    expect([...image.data]).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
});

for (const mode of ["buffered", "retained", "sync"] as const)
it(`keeps ordinary animations and scene output in ${mode}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "2x1", "xc:red", "xc:lime", "xc:blue", "-write", "out.gif", "frame%02d.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const names = mode === "retained" ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()];
    expect(names.sort()).toEqual(["frame00.png", "frame01.png", "frame02.png", "out.gif"]);
    for (const [index, name] of ["frame00.png", "frame01.png", "frame02.png"].entries()) {
        const bytes = mode === "retained" ? await filesystem.readFile(`/${name}`) : files.get(name)!;
        expect([...decodeImage(bytes).data.slice(0, 4)]).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]][index]);
    }
    const bytes = mode === "retained" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(decodeImage(bytes, { animated: true }).pages).toBe(3);
});
