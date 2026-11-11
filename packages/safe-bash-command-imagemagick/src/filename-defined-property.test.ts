import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const write of [false, true])
for (const { options, property, filename } of [
    { options: ["-set", "label", "sample"], property: "label", filename: "xsample.png" },
    { options: ["-set", "tag", "sample"], property: "tag", filename: "xsample.png" },
    { options: ["-set", "option:tag", "sample"], property: "tag", filename: "xsample.png" },
    { options: ["-set", "filename:tag", "sample"], property: "filename:tag", filename: "xsample.png" },
    { options: ["-set", "option:tag", "sample"], property: "option:tag", filename: "x[option:tag].png" },
    { options: ["-scene", "7"], property: "scene", filename: "x7.png" },
    { options: [], property: "scene", filename: "x[scene].png" },
    { options: ["-scene", "7", "+scene"], property: "scene", filename: "x[scene].png" },
    { options: ["-scene", "%n"], property: "scene", filename: "x2.png" },
])
it(`resolves output ${property} with ${options.join(" ")} in ${mode}, write=${write}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const output = `x%[${property}].png`;
    const args = ["xc:red", "xc:blue", ...options, "+adjoin", ...(write ? ["-write", output, "null:"] : [output])];
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
    expect(names).toEqual([filename]);
    const bytes = retained ? await filesystem.readFile(`/${filename}`) : files.get(filename)!;
    const image = decodeImage(bytes, { animated: true });
    expect([image.width, image.height, image.pages ?? 1]).toEqual([1, 1, 1]);
    expect([...image.data]).toEqual([0, 0, 255, 255]);
});
