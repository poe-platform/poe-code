import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMogrifyCommand, createMagickCommand, runMogrifyCli, runMagickCli } from "./index.js";

for (const entry of ["sdk", "magick-sdk", "command", "magick-command"] as const)
for (const settings of [[], ["-format", "bmp"], ["-path", "result", "-format", "png"]])
it(`retains mogrify batch files via ${entry} ${settings.join(" ")}`, async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 29, height: 31, channels: 4, background: "#abcdef80" } }).png().toBuffer();
    await fs.mkdir("/result");
    await fs.writeFile("/one.png", bytes); await fs.writeFile("/two.png", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file mogrify I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = [...settings, "-resize", "13x17!", "-alpha", "remove", "one.png", "two.png"], files = new Map([["one.png", bytes], ["two.png", bytes]]);
    const expected = await runMogrifyCli(args, files);
    if (entry === "sdk" || entry === "magick-sdk") {
        const runner = entry === "sdk" ? runMogrifyCli : runMagickCli;
        expect(await runner(entry === "sdk" ? args : ["mogrify", ...args], { filesystem, cwd: "/" })).toEqual(expected);
    } else {
        const command = entry === "command" ? createMogrifyCommand() : createMagickCommand();
        const arguments_ = createCommandArguments(entry === "command" ? args : ["mogrify", ...args]);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    }
    for (const [path, data] of files) expect(decodeImage(await fs.readFile("/" + path))).toEqual(decodeImage(data));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(settings.includes("bmp") ? ["one.bmp", "one.png", "result", "two.bmp", "two.png"] : ["one.png", "result", "two.png"]);
});

it("preserves missing-input diagnostics after completing earlier targets", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 29, height: 31, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/one.png", bytes);
    const files = new Map([["one.png", bytes]]), args = ["-resize", "13x17!", "one.png", "absent.png"];
    expect(await runMogrifyCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runMogrifyCli(args, files));
    expect(decodeImage(await fs.readFile("/one.png"))).toEqual(decodeImage(files.get("one.png")!));
});

it("enforces a cumulative input budget across targets", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 29, height: 31, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/one.png", bytes); await fs.writeFile("/two.png", bytes);
    const failure = new Error("batch input budget"), totals: number[] = [];
    await expect(runMogrifyCli(["-resize", "13x17!", "one.png", "two.png"], { filesystem: fs, cwd: "/", inputBudget: { check(total) { totals.push(total); if (total > bytes.length) throw failure; } } })).rejects.toBe(failure);
    expect(totals.at(-1)).toBe(bytes.length * 2);
    expect(decodeImage(await fs.readFile("/one.png")).width).toBe(13);
    expect(await fs.readFile("/two.png")).toEqual(bytes);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["one.png", "two.png"]);
});

it("preserves unexpected filesystem errors", async () => {
    const fs = new MemoryFileSystem(), failure = new Error("remote stat failed");
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "stat") return () => { throw failure; };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runMogrifyCli(["one.png"], { filesystem, cwd: "/" })).rejects.toBe(failure);
});

it.each(["bmp", "gif"] as const)("preserves extensionless %s conversion behavior", async format => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 29, height: 31, channels: 4, background: "red" } }).toFormat(format).toBuffer();
    await fs.writeFile("/input", bytes);
    const files = new Map([["input", bytes]]), args = ["-resize", "13x17!", "input"];
    expect(await runMogrifyCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runMogrifyCli(args, files));
    expect(decodeImage(await fs.readFile("/input"))).toEqual(decodeImage(files.get("input")!));
});

for (const entry of ["sdk", "magick-sdk", "command", "magick-command"] as const)
for (const firstTarget of [false, true])
it(`replaces the mogrify symlink entry via ${entry}, target first=${firstTarget}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = await sharp(new Uint8Array([255, 0, 0, 0, 255, 0]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
    await fs.writeFile("/a.png", bytes);
    await fs.symlink("a.png", "/link.png");
    expect(await fs.readlink("/link.png")).toBe("a.png");
    const args = ["-negate", ...(firstTarget ? ["a.png"] : []), "link.png"];
    if (entry === "sdk" || entry === "magick-sdk") {
        const runner = entry === "sdk" ? runMogrifyCli : runMagickCli;
        expect((await runner(entry === "sdk" ? args : ["mogrify", ...args], { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    } else {
        const command = entry === "command" ? createMogrifyCommand() : createMagickCommand();
        const arguments_ = createCommandArguments(entry === "command" ? args : ["mogrify", ...args]);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    }
    expect((await fs.lstat("/link.png")).type).toBe("file");
    await expect(fs.readlink("/link.png")).rejects.toMatchObject({ code: "EINVAL" });
    const original = decodeImage(bytes);
    const rewritten = { ...original, bitsPerSample: 1, depth: "bit", isPalette: true };
    const negated = { ...rewritten, data: new Uint8Array([0, 255, 255, 255, 255, 0, 255, 255]) };
    expect(decodeImage(await fs.readFile("/a.png"))).toEqual(firstTarget ? negated : original);
    if (!firstTarget) expect(await fs.readFile("/a.png")).toEqual(bytes);
    expect(decodeImage(await fs.readFile("/link.png"))).toEqual(firstTarget ? rewritten : negated);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a.png", "link.png"]);
});

for (const failure of ["conversion", "budget", "rename"] as const)
it(`preserves the symlink and cleans staging on ${failure} failure`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    await fs.writeFile("/a.png", bytes);
    await fs.symlink("a.png", "/link.png");
    const filesystem = new Proxy(fs, { get(target, key) {
        if (failure === "rename" && key === "rename") return () => { throw new Error("rename failed"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const operation = runMogrifyCli([failure === "conversion" ? "-invalid-option" : "-negate", "link.png"], {
        filesystem, cwd: "/", inputBudget: { check() { if (failure === "budget") throw new Error("budget failed"); } }
    });
    if (failure === "conversion") expect((await operation).exitCode).toBe(1);
    else await expect(operation).rejects.toThrow(`${failure} failed`);
    expect((await fs.lstat("/link.png")).type).toBe("symlink");
    expect(await fs.readlink("/link.png")).toBe("a.png");
    expect(await fs.readFile("/a.png")).toEqual(bytes);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a.png", "link.png"]);
});

it("keeps the input symlink when mogrify writes to a separate directory", async () => {
    const fs = new MemoryFileSystem();
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    await fs.writeFile("/a.png", bytes);
    await fs.symlink("a.png", "/link.png");
    await fs.mkdir("/result");
    expect((await runMogrifyCli(["-path", "result", "-negate", "link.png"], { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    expect((await fs.lstat("/link.png")).type).toBe("symlink");
    expect(await fs.readlink("/link.png")).toBe("a.png");
    expect(await fs.readFile("/a.png")).toEqual(bytes);
    expect(Array.from(decodeImage(await fs.readFile("/result/link.png")).data)).toEqual([0, 255, 255, 255, 0, 255, 255, 255]);
});
