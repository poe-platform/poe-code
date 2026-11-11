import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick keeps both P6 frames in one file when the pattern contains %%.
const red = "50360a3120310a3235350aff0000", lime = "50360a3120310a3235350a00ff00";
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const write of [false, true])
for (const [pattern, split, expected] of [
    ["out-%%-%d.ppm", false, { "out-%-0.ppm": red + lime }],
    ["out-%%-%d.ppm", true, { "out-%-0.ppm": red, "out-%-1.ppm": lime }],
    ["out-%d.ppm", false, { "out-0.ppm": red, "out-1.ppm": lime }],
    ["out-%d-%%.ppm", false, { "out-0-%.ppm": red + lime }],
    ["out-%%%02d.ppm", false, { "out-%00.ppm": red + lime }],
] as const)
it(`preserves percent-pattern frame grouping: ${mode}, write=${write}, split=${split}, ${pattern}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:red", "xc:lime", "-depth", "8", ...(split ? ["+adjoin"] : []), ...(write ? ["-write", pattern, "+append", "rgb:-"] : [pattern])];
    let stdout: Uint8Array;
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } } as CommandContext)).toEqual({ exitCode: 0 });
        expect(Buffer.concat(errors).toString()).toBe("");
        stdout = Buffer.concat(chunks);
    } else {
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        stdout = result.stdoutBytes ?? new Uint8Array();
    }
    expect(Buffer.from(stdout).toString("hex")).toBe(write ? "ff000000ff00" : "");
    if (mode === "command" || mode === "retained") {
        for (const entry of await filesystem.readdir("/")) files.set(entry.name, await filesystem.readFile(`/${entry.name}`));
    }
    expect(Object.fromEntries([...files].map(([name, bytes]) => [name, Buffer.from(bytes).toString("hex")]))).toEqual(expected);
});
