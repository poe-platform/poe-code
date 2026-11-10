import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "sync"] as const) {
    async function execute(argv: string[], files: Map<string, Uint8Array>) {
        if (mode === "sync") return { ...runMagickCliSync(argv, files), read: async (path: string) => files.get(path)! };
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        return { ...result, stderr, read: (path: string) => fs.readFile(path) };
    }

    it(`writes separate RGB partitions without replacing the named output (${mode})`, async () => {
        const rgb = Uint8Array.from({ length: 36 }, (_, i) => (7 * i + 1) % 256);
        const png = await sharp(rgb, { raw: { width: 3, height: 4, channels: 3 } }).png().toBuffer();
        const files = new Map<string, Uint8Array>([["/i.png", png], ["/out.rgb", keep], ["/out.R", keep], ["/out.G", keep], ["/out.B", keep]]);
        const result = await execute(["/i.png", "-depth", "8", "-interlace", "Partition", "/out.rgb"], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(await result.read("/out.rgb")).toEqual(keep);
        for (const [index, channel] of [..."RGB"].entries()) expect(await result.read(`/out.${channel}`)).toEqual(rgb.filter((_, i) => i % 3 === index));
    });

    it.each(["Partition", "None"])(`reads %s RGB samples (${mode})`, async interlace => {
        const rgb = Uint8Array.from({ length: 36 }, (_, i) => (7 * i + 1) % 256);
        const files = new Map<string, Uint8Array>([["/out.png", keep]]);
        if (interlace === "None") files.set("/part.rgb", rgb);
        else for (const [index, channel] of [..."RGB"].entries()) files.set(`/part.${channel}`, rgb.filter((_, i) => i % 3 === index));
        const result = await execute(["-size", "3x4", "-depth", "8", "-interlace", interlace, "rgb:/part.rgb", "-interlace", "None", "/out.png"], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const decoded = await sharp(await result.read("/out.png")).removeAlpha().raw().toBuffer();
        expect(new Uint8Array(decoded)).toEqual(rgb);
    });

    it.each(["MSB", "LSB"])(`preserves 16-bit samples across chunk boundaries and -write resets (${mode}, %s)`, async endian => {
        const rgb = Uint8Array.from({ length: 3001 * 2 * 6 }, (_, i) => (i * 43 + 17) % 256);
        const files = new Map<string, Uint8Array>([["/in.rgb", rgb], ["/multi.name.rgb", keep]]);
        const result = await execute(["-size", "3001x2", "-depth", "16", "-endian", endian, "rgb:/in.rgb", "-interlace", "Partition", "-write", "rgb:/multi.name.rgb", "+interlace", "rgb:/packed.rgb"], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(await result.read("/multi.name.rgb")).toEqual(keep);
        expect(await result.read("/packed.rgb")).toEqual(rgb);
        const partitions = new Map<string, Uint8Array>();
        for (const [index, channel] of [..."RGB"].entries()) {
            const bytes = await result.read(`/multi.name.${channel}`);
            expect(bytes).toEqual(rgb.filter((_, i) => Math.floor(i / 2) % 3 === index));
            partitions.set(`/multi.name.${channel}`, bytes);
        }
        const decoded = await execute(["-size", "3001x2", "-depth", "16", "-endian", endian, "-interlace", "Partition", "rgb:/multi.name.rgb", "+interlace", "rgb:/decoded.rgb"], partitions);
        expect(decoded.stderr).toBe("");
        expect(decoded.exitCode).toBe(0);
        expect(await decoded.read("/decoded.rgb")).toEqual(rgb);
    });

    it.each(["missing", "short"])(`preserves output when a partition is %s (${mode})`, async fault => {
        const files = new Map<string, Uint8Array>([["/part.R", new Uint8Array(12)], ["/part.G", new Uint8Array(12)], ["/out.png", keep]]);
        if (fault === "short") files.set("/part.B", new Uint8Array(11));
        const result = await execute(["-size", "3x4", "-depth", "8", "-interlace", "Partition", "rgb:/part.rgb", "-interlace", "None", "/out.png"], files);
        expect(result.exitCode).toBe(1);
        expect(await result.read("/out.png")).toEqual(keep);
    });

}
