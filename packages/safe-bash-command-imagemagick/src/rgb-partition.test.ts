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

    it.each(["rgb", "rgba", "bgr", "bgra"].flatMap(format => [8, 16].flatMap(depth => [1, 2].map(frames => ({ format, depth, frames })))))(`writes native $format $depth-bit $frames-frame Partition planes and preserves frame order (${mode})`, async ({ format, depth, frames }) => {
        const pixels = Uint8Array.from(Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex"));
        const second = new Uint8Array(pixels.length);
        for (let i = 0; i < 6; i++) second.set(pixels.subarray(i * 4, i * 4 + 4), (5 - i) * 4);
        const header = new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
        const files = new Map<string, Uint8Array>([
            ["/in.pam", new Uint8Array([...header, ...pixels])],
            ["/second.pam", new Uint8Array([...header, ...second])],
            ["/out", keep], ["/copy.raw", keep]
        ]);
        const result = await execute(["/in.pam", ...(frames === 2 ? ["/second.pam"] : []), "-interlace", "Partition", "-depth", String(depth), "-write", `${format}:/copy.raw`, `${format}:/out`], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(await result.read("/out")).toEqual(keep);
        expect(await result.read("/copy.raw")).toEqual(keep);
        for (const channel of format.toUpperCase()) {
            const index = "RGBA".indexOf(channel);
            const samples = new Uint8Array([...pixels.filter((_, i) => i % 4 === index), ...(frames === 2 ? second.filter((_, i) => i % 4 === index) : [])]);
            const expected = depth === 8 ? samples : Uint8Array.from([...samples].flatMap(sample => [sample, sample]));
            expect(await result.read(`/out.${channel}`)).toEqual(expected);
            expect(await result.read(`/copy.${channel}`)).toEqual(expected);
        }
    });

    it.each([
        { format: "gray", planes: { G: "3ea96c4d" } },
        { format: "graya", planes: { G: "3ea96c4d", A: "9a43ff00" } },
        { format: "cmyk", planes: { C: "d9000092", M: "6c2a6a49", Y: "00c12700", K: "8732638c" } },
        { format: "cmyka", planes: { C: "d9000092", M: "6c2a6a49", Y: "00c12700", K: "8732638c", A: "9a43ff00" } }
    ].flatMap(fixture => [1, 2].map(frames => ({ ...fixture, frames }))))(`writes $format Partition channel files for $frames frames (${mode})`, async ({ format, planes, frames }) => {
        const files = new Map<string, Uint8Array>([["/out", keep], ["/copy.raw", keep]]);
        const result = await execute([
            "xc:#1245789a", "xc:#cdab3243", "+append", "(", "xc:#9c5b84ff", "xc:#31527300", "+append", ")", "-append",
            ...(frames === 2 ? ["-clone", "0"] : []),
            "-depth", "8", "-endian", "MSB", "-interlace", "Partition", "-write", `${format}:/copy.raw`, "-write", `${format}:/out`,
            "-interlace", "Plane", `${format}:/plane`
        ], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(await result.read("/out")).toEqual(keep);
        expect(await result.read("/copy.raw")).toEqual(keep);
        for (const [channel, hex] of Object.entries(planes)) {
            const expected = Uint8Array.from(Buffer.from(hex!.repeat(frames), "hex"));
            expect(await result.read(`/out.${channel}`)).toEqual(expected);
            expect(await result.read(`/copy.${channel}`)).toEqual(expected);
        }
        expect(await result.read("/plane")).toEqual(Uint8Array.from(Buffer.from(Object.values(planes).join("").repeat(frames), "hex")));
        const final = await execute([
            "xc:#1245789a", "xc:#cdab3243", "+append", "(", "xc:#9c5b84ff", "xc:#31527300", "+append", ")", "-append",
            ...(frames === 2 ? ["-clone", "0"] : []),
            "-depth", "8", "-endian", "MSB", "-interlace", "Partition", `${format}:/out`
        ], files);
        expect(final.exitCode).toBe(0);
        expect(await final.read("/out")).toEqual(keep);
        for (const [channel, hex] of Object.entries(planes)) expect(await final.read(`/out.${channel}`)).toEqual(Uint8Array.from(Buffer.from(hex!.repeat(frames), "hex")));
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

    it.each(["Partition", "None"].flatMap(interlace => ["", "[0]"].map(selector => ({ interlace, selector }))))(`reads the native RGB frame count for $interlace $selector (${mode})`, async ({ interlace, selector }) => {
        const rgb = Buffer.from("010203040506111213141516212223242526", "hex");
        const files = new Map<string, Uint8Array>();
        if (interlace === "None") files.set("/in.bin", rgb);
        else for (const [index, channel] of [..."RGB"].entries()) files.set(`/in.${channel}`, rgb.filter((_, i) => i % 3 === index));
        const result = await execute([
            "-size", "2x1", "-depth", "8", "-interlace", interlace, `rgb:/in.bin${selector}`,
            "+interlace", "-write", "rgb:/out", "-format", "%s/%p/%n;", "info:/frames"
        ], files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const singleFrame = interlace === "Partition" || selector === "[0]";
        expect(Buffer.from(await result.read("/out"))).toEqual(singleFrame ? rgb.subarray(0, 6) : rgb);
        expect(new TextDecoder().decode(await result.read("/frames"))).toBe(singleFrame ? "0/0/1;" : "0/0/3;1/1/3;2/2/3;");
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
