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
