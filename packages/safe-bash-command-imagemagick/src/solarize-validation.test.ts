import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native PNG48, RGB values: 1, 255, 256, 32767, 32768, 32769, 65534, 65535.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAABEAIAAAA88qRXAAAAJklEQVQI1yXJMQ4AAAgCMe7j+nLQga1JEUIoigIAc3NzdXe9XtcPGiYL/D1JW+kAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["1xq", "50+2+3+4", "bogus", "50%junk", "50%xjunk", "50x1%junk", "", "NaN", "Infinity", "0x1p15", "0x32%junk", "0x", "0b10", "0o10", "50%"])(`${mode}: validates solarize threshold %j before replacing output`, async threshold => {
        const original = await sharp(Uint8Array.from([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.png", "-solarize", threshold, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (threshold === "50%") {
            expect(result.exitCode).toBe(0);
            expect(decodeImage(output).width).toBe(8);
        } else {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument '-solarize'");
            expect(output).toEqual(original);
        }
    });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["32768", "50%", "0x8000", "0X8000", "+0x8000", "0x32%", "-0x1"])(`${mode}: matches native solarize pixels for threshold %s`, async threshold => {
        const input = await sharp(Uint8Array.from(Buffer.from("0001ff402050807f7f808180c8a064dc", "hex")), {
            raw: { width: 4, height: 1, channels: 4 }
        }).png().toBuffer();
        const files = new Map([["/in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", "-solarize", threshold, "PNG32:/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(threshold === "-0x1" ? [
            255, 254, 0, 191, 223, 175, 127, 128, 128, 127, 126, 127, 55, 95, 155, 35,
        ] : [
            0, 1, 0, 64, 32, 80, 127, 127, 127, 127, 126, 127, 55, 95, 100, 35,
        ]);
    });
}
