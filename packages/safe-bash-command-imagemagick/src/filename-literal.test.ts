import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "command", "sync"] as const)
for (const write of [false, true])
for (const [pattern, names, single = false] of [
    ["frame%d.png", ["frame%d.png"], true],
    ["frame%d.png", ["frame%d-0.png", "frame%d-1.png"]],
    ["frame%%.png", ["frame%%-0.png", "frame%%-1.png"]],
    ["frame%d.gif", ["frame%d-0.gif"]],
    ["frame%02d.gif", ["frame%02d-0.gif"]],
] as const)
it(`honors filename:literal: ${mode}, write=${write}, ${pattern}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const output = pattern;
    const args = ["-size", "1x1", "xc:red", ...(single ? [] : ["xc:blue"]), "-define", "filename:literal=true", ...(write ? ["-write", output, "+define", "filename:literal", "null:"] : [output])];
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
        const expected = index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255];
        expect([...image.data]).toEqual(expected);
        if (pattern.endsWith(".gif")) {
            const bytes = (mode === "buffered" || mode === "sync") ? files.get(name)! : await filesystem.readFile(`/${name}`);
            expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(names.length === 1 ? 2 : 1);
            if (names.length === 1) expect([...await sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer()]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
        }
    }
});

for (const retained of [false, true])
for (const reset of [["+define", "filename:literal"], ["-define", "filename:literal=false"], []])
it(`preserves default expansion after reset ${reset.join(" ")} (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const settings = reset.length ? ["-define", "filename:literal=true", ...reset] : [];
    expect(await runMagickCli(["-size", "1x1", "xc:red", "xc:blue", ...settings, "frame%02d.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()];
    expect(names.sort()).toEqual(["frame00.png", "frame01.png"]);
});

for (const mode of ["buffered", "retained", "command", "sync"] as const)
for (const write of ["final", "-write", "+write"])
for (const count of [1, 2])
for (const setting of ["literal", "default", "reset", "false"])
it(`preserves bracketed filename properties: ${mode}, ${write}, frames=${count}, ${setting}`, async () => {
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const settings = setting === "default" ? [] : ["-define", "filename:literal=true", ...(setting === "reset" ? ["+define", "filename:literal"] : setting === "false" ? ["-define", "filename:literal=false"] : [])];
    const output = "out-%[filename:tag].ppm";
    const args = ["xc:red", ...(count === 2 ? ["xc:lime"] : []), "-depth", "8", "-set", "filename:tag", "snap", ...settings, ...(write === "final" ? [output] : [write, output, "+append", "rgb:-"])];
    let stdout: Uint8Array;
    if (mode === "command") {
        const command = createMagickCommand(), arguments_ = createCommandArguments(args);
        const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } } as CommandContext)).toEqual({ exitCode: 0 });
        stdout = Buffer.concat(chunks);
        expect(Buffer.concat(errors).length).toBe(0);
    } else {
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        stdout = result.stdoutBytes ?? new TextEncoder().encode(result.stdout);
    }
    const literal = setting === "literal";
    const name = literal ? `out-%[filename:tag]${count === 2 ? "-0" : ""}.ppm` : "out-snap.ppm";
    const inMemory = mode === "buffered" || mode === "sync";
    expect(inMemory ? [...files.keys()] : (await filesystem.readdir("/")).map(entry => entry.name)).toEqual([name]);
    const red = "50360a3120310a3235350aff0000", lime = "50360a3120310a3235350a00ff00";
    expect(Buffer.from(inMemory ? files.get(name)! : await filesystem.readFile(`/${name}`)).toString("hex")).toBe(count === 1 ? red : literal ? red + lime : lime);
    expect(Buffer.from(stdout).toString("hex")).toBe(write === "final" ? "" : count === 1 ? "ff0000" : "ff000000ff00");
});
