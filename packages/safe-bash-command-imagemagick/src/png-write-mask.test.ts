import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./png-write-mask-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI; native PNG outputs decoded to MSB RGBA8/16.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: PNG alpha respects $name at $depth bits`, async ({ input, args, depth, rgba }) => {
        const files = new Map(Object.entries(fixtures.inputs).map(([name, bytes]) => [`/${name}.png`, Buffer.from(bytes, "base64")]));
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = [`/${input}.png`, ...args.map(arg => arg.endsWith(".png") ? `/${arg}` : arg), `${depth === 16 ? "PNG64" : "PNG32"}:/out.png`];
        const commandArgs = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: commandArgs.args, argumentValues: commandArgs,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const expected = Buffer.from(rgba, "base64");
        expect(Array.from(depth === 16 ? output.data16! : output.data)).toEqual(depth === 16
            ? Array.from({ length: expected.length / 2 }, (_, index) => expected.readUInt16BE(index * 2)) : [...expected]);
    });
}

for (const retained of [false, true]) {
    it(`keeps output alpha changes local to an intermediate write (retained=${retained})`, async () => {
        const files = new Map(Object.entries(fixtures.inputs).map(([name, bytes]) => [`/${name}.png`, Buffer.from(bytes, "base64")]));
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const result = await runMagickCli(["/rgb.png", "-write-mask", "/mask.png", "-write", "PNG32:/masked.png", "+write-mask", "PNG32:/after.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const masked = decodeImage(retained ? await filesystem.readFile("/masked.png") : files.get("/masked.png")!);
        expect([...masked.data]).toEqual([...Buffer.from(fixtures.cases[0]!.rgba, "base64")]);
        const after = decodeImage(retained ? await filesystem.readFile("/after.png") : files.get("/after.png")!);
        expect(after.data).toEqual(decodeImage(files.get("/rgb.png")!).data);
    });

    it(`preserves region coordinates across PNG64 output chunks (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = await runMagickCli(["-size", "4098x2", "xc:red", "-region", "2x1+4095+1", "PNG64:/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const expected = Uint16Array.from({ length: 4098 * 2 * 4 }, (_, index) => index % 4 === 0 || index % 4 === 3 ? 65535 : 0);
        expected[(4098 + 4095) * 4 + 3] = expected[(4098 + 4096) * 4 + 3] = 0;
        expect(output.data16).toEqual(expected);
    });
}
