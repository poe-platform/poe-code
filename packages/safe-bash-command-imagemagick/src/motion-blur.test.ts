import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runConvertCli, runMogrifyCli, runIdentifyCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAIAAAAG+GGPAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcMLAChJwkmAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEyOjQ0OjAwKzAwOjAwdXD43AAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMjo0NDowMCswMDowMAQtQGAAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTI6NDQ6MDArMDA6MDBTOGG/AAAAEGNhTnYAAAANAAAACwAAAAMAAAACP+HC8wAAABtJREFUCNdjZGD4L8L+DQ2xMHP9ZmZHR5SLAgCpQyQPCtg/oQAAAABJRU5ErkJggg==", "base64");
for (const retained of [false, true])
for (const mogrify of [false, true])
it.each([
    ["0x0+0", "7ad426235ab8c6852a1daccaa00a416765951f1248727bd0f8a9d0357ffa45d9"],
    ["3x1+0", "cfac5f4f5a9d982bfcc30d5258d6cedda7ef1cdfe2da318e4c4040b0300dad19"],
    ["3x1+90", "6b1adde1f9c2d7109362f126e03eee058157513c98ffcfb40d3b5bf28d7cb8f6"],
    ["3x1+45", "c3239686ad033b48c8f3b67d50d2dcc505e0d98e78e4933348fd74a19b666b18"]
])(`matches native full RGBA motion blur %s (retained=${retained}, mogrify=${mogrify})`, async (geometry, hash) => {
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = mogrify ? ["-motion-blur", geometry, "input.png"] : ["input.png", "-motion-blur", geometry, "out.png"];
    const result = await (mogrify ? runMogrifyCli : runConvertCli)(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const name = mogrify ? "input.png" : "out.png";
    const bytes = retained ? await fs.readFile(`/${name}`) : files.get(name)!;
    expect(runIdentifyCliSync(["-format", "%g", name], new Map([[name, bytes]])).stdout).toBe("13x11+3+2");
    const output = decodeImage(bytes);
    expect([output.width, output.height]).toEqual([7, 5]);
    expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
});

for (const retained of [false, true])
it.each([
    [[], "0x1+0", [182, 69, 4, 204, 0, 219, 36, 106, 0, 0, 255, 35]],
    [[], "2x1+180", [255, 0, 0, 255, 139, 116, 0, 201, 56, 146, 53, 97]],
    [["-channel", "R"], "0x1+0", [182, 0, 0, 255, 0, 255, 0, 160, 0, 0, 255, 35]],
    [["-channel", "A"], "0x1+0", [255, 0, 0, 204, 0, 255, 0, 106, 0, 0, 255, 35]],
    [["-virtual-pixel", "tile"], "0x1+0", [183, 69, 3, 205, 40, 190, 25, 124, 186, 26, 43, 121]],
    [["-virtual-pixel", "transparent"], "0x1+0", [182, 69, 3, 203, 0, 225, 30, 103, 0, 0, 255, 20]]
] as const)(`matches native alpha and virtual pixels %j %s (retained=${retained})`, async (options, geometry, expected) => {
    const pixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 160, 0, 0, 255, 35]);
    const input = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file motion blur I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await runConvertCli(["input.png", ...options, "-motion-blur", geometry, "out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual(expected);
});

for (const retained of [false, true])
it(`rejects oversized motion kernels without replacing output (retained=${retained})`, async () => {
    const files = new Map([["input.png", input], ["out.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    await fs.writeFile("/out.png", input);
    const result = await runConvertCli(["input.png", "-motion-blur", "5000x1", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("limit");
    expect(Array.from(retained ? await fs.readFile("/out.png") : files.get("out.png")!)).toEqual(Array.from(input));
});

for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    ["+35", "65448c4b3e5899748c3e4f97c01060e0435054528287766c866d5e9b90102080"],
    ["-35", "65448c4b3e5899748c3e4f97c01060e0435054528287766c866d5e9b90102080"],
    ["35", "65448c4b3e5899748c3e4f97c01060e0435054528287766c866d5e9b90102080"],
    ["0x1+35", "a25e5e40546fa6876050286eb2104db7435255528287766c866d5e9b90102080"]
])(`matches native signed motion blur geometry %s via ${mode}`, async (geometry, expected) => {
    const input = Buffer.concat([
        Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
    ]);
    const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.pam", "-motion-blur", geometry, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
    expect(result.exitCode, stderr).toBe(0);
    expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
});
