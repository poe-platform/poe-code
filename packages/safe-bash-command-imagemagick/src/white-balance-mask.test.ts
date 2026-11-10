import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded as 8-bit RGBA after PNG32 output.
const cases = [
    { name: "right-hand region", before: ["-region", "2x1+2+0"], after: ["+region"], rgba: "c07030ffa09070ff2a2f46ff16202aff" },
    { name: "write mask", before: ["-write-mask", "mask.png"], after: ["+write-mask"], rgba: "c07030ffa09070ff2a2f46ff16202aff" },
    { name: "single-pixel region", before: ["-region", "1x1+0+0"], after: ["+region"], rgba: "dc5d0cffa09070ff203050ff102030ff" },
    { name: "full-width region", before: ["-region", "4x1+0+0"], after: ["+region"], rgba: "b9743aff949379ff173153ff0b2031ff" },
    { name: "write mask across chunk boundaries", rows: 129, before: ["-write-mask", "mask.png"], after: ["+write-mask"], rgba: "c07030ffa09070ff2a2f46ff16202aff" },
    { name: "region across chunk boundaries", rows: 129, before: ["-region", "2x129+2+0"], after: ["+region"], rgba: "c07030ffa09070ff2a2f46ff16202aff" },
    { name: "read mask", before: ["-read-mask", "mask.png"], after: ["+read-mask"], rgba: "b9743aff949379ff173153ff0b2031ff" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`white-balances $name with native pixels via ${mode}`, async ({ before, after, rgba, rows = 1 }) => {
        const input = await sharp(Buffer.from("c07030a09070203050102030".repeat(rows), "hex"), {
            raw: { width: 4, height: rows, channels: 3 }
        }).png().toBuffer();
        const mask = await sharp(Uint8Array.from({ length: rows * 4 }, (_, index) => index % 4 < 2 ? 255 : 0), {
            raw: { width: 4, height: rows, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["input.png", input], ["mask.png", mask]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file white balance forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        const args = ["input.png", ...before, "-white-balance", ...after, "PNG32:output.png"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage((mode === "retained" || mode === "command") ? await fs.readFile("/output.png") : files.get("output.png")!);
        expect([output.width, output.height]).toEqual([4, rows]);
        expect(Buffer.from(output.data).toString("hex")).toBe(rgba.repeat(rows));
    });
}
