import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli } from "./index.js";

it.each(["sdk", "identify", "magick"] as const)("awaits %s output before acquiring the next input", async route => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 2, height: 3, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/a", bytes);
    await fs.writeFile("/b", bytes);
    const opened: string[] = [], chunks: Uint8Array[] = [];
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { entered = resolve; });
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => { opened.push(args[0]); return fs.openReadFile(...args); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const stdout = { async write(chunk: Uint8Array) { chunks.push(chunk.slice()); entered(); await gate; } };
    const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
    const argumentValues = createCommandArguments(route === "magick" ? ["identify", "a", "b"] : ["a", "b"]);
    const pending = route === "sdk" ? runIdentifyCli(["a", "b"], { filesystem, cwd: "/", stdout }) : command.execute({ command: command.name, args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(), stdout, stderr: { async write() {} } });
    await Promise.race([writing, Promise.resolve(pending).then(() => { throw new Error("identify completed without streaming output"); })]);
    expect(opened).toEqual(["/a"]);
    release();
    const result = await pending;
    expect(result).toEqual(route === "sdk" ? { exitCode: 0, stdout: "", stderr: "" } : { exitCode: 0 });
    const text = chunks.map(chunk => new TextDecoder().decode(chunk)).join("");
    expect(text).toBe((await runIdentifyCli(["a", "b"], new Map([["a", bytes], ["b", bytes]]))).stdout);
});
it.each(["stdout", "stderr"] as const)("propagates identify %s sink failures unchanged", async channel => {
    const fs = new MemoryFileSystem(), reason = new Error("sink refused");
    const bytes = await sharp({ create: { width: 2, height: 3, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/a", bytes);
    await expect(runIdentifyCli([channel === "stdout" ? "a" : "missing"], { filesystem: fs, cwd: "/", [channel]: { async write() { throw reason; } } })).rejects.toBe(reason);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["a"]);
});

it("streams long Unicode formats in bounded owned chunks", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/a", bytes);
    const format = "x".repeat(4095) + "😀" + "é😀".repeat(5000), chunks: Uint8Array[] = [];
    const result = await runIdentifyCli(["-format", format, "a", "a"], { filesystem: fs, cwd: "/", stdout: { async write(bytes) { expect(bytes.length).toBeLessThanOrEqual(4096); chunks.push(bytes); } } });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).toBe(format.repeat(2));
    expect(chunks.length).toBeGreaterThan(10);
});
it.each(["--help", "--version", "-list"])("sends %s output to the selected SDK sink", async option => {
    const fs = new MemoryFileSystem();
    let text = "";
    const args = option === "-list" ? [option, "format"] : [option];
    const result = await runIdentifyCli(args, { filesystem: fs, cwd: "/", stdout: { async write(bytes) { text += new TextDecoder().decode(bytes); } } });
    expect(text).toBe((await runIdentifyCli(args, new Map())).stdout);
    expect(result.stdout).toBe("");
});
it("stops before the next operand when identify output is cancelled", async () => {
    const fs = new MemoryFileSystem(), controller = new AbortController(), reason = new Error("cancel output");
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/a", bytes);
    await expect(runIdentifyCli(["a", "missing"], { filesystem: fs, cwd: "/", stdout: { async write() { controller.abort(reason); } }, stderr: { async write() { throw new Error("next operand should not run"); } } }, undefined, controller.signal)).rejects.toBe(reason);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["a"]);
});
