import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const write of [false, true])
for (const extension of ["png", "gif"])
for (const single of [true, false])
for (const property of ["bogus", "missing", "filename:missing"])
it(`writes unresolved ${property} to ${extension} in ${mode}, write=${write}, single=${single}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const output = `v%[${property}].${extension}`;
    expect(runConvertCliSync(["-size", "2x1", "-delay", "4", "xc:red", "-delay", "8", "xc:lime", "-delay", "12", "xc:blue", "in.gif"], files).exitCode).toBe(0);
    await filesystem.writeFile("/in.gif", files.get("in.gif")!);
    const args = [single ? "in.gif[0]" : "in.gif", ...(write ? ["-write", output, "null:"] : [output])];
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
    expect(names.sort()).toEqual(["in.gif", `v[${property}].${extension}`]);
    const bytes = retained ? await filesystem.readFile(`/v[${property}].${extension}`) : files.get(`v[${property}].${extension}`)!;
    const image = decodeImage(bytes, { animated: true });
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(image.pages ?? 1).toBe(1);
    const color = single ? [255, 0, 0, 255] : [0, 0, 255, 255];
    expect([...image.data]).toEqual([...color, ...color]);
});
