import { expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("123456234567345678fedcbaf0d0b0e0c0a0", "hex")]);
const literal = "123456234567345678fedcbaf0d0b0e0c0a0";
const differences = "123456111111111111fedcbaf2f4f6f0f0f0";
function tags(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ifd = view.getUint32(4, true);
    const result = new Map<number, { value: number; at: number }>();
    for (let i = 0; i < view.getUint16(ifd, true); i++) {
        const at = ifd + 2 + i * 12;
        result.set(view.getUint16(at, true), { value: view.getUint16(at + 2, true) === 3 ? view.getUint16(at + 8, true) : view.getUint32(at + 8, true), at: at + 8 });
    }
    return result;
}
for (const mode of ["sync", "buffered", "public"] as const) {
    for (const compression of ["Zip", "LZW", "None"] as const) {
        it.each([undefined, 1, 2])(`writes actual horizontal differences (${mode}, ${compression}, predictor=%s)`, async predictor => {
            const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const argv = ["/in.ppm", "-compress", compression, ...(predictor === undefined ? [] : ["-define", `tiff:predictor=${predictor}`]), "-write", "/copy.tif", "/out.tif"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
            expect(result.exitCode, stderr).toBe(0);
            if ("stderr" in result) expect(result.stderr).toBe("");
            for (const path of ["/copy.tif", "/out.tif"]) {
                const bytes = mode === "public" ? await fs.readFile(path) : files.get(path)!;
                const entries = tags(bytes), predicted = compression !== "None" && predictor !== 1;
                expect(entries.get(259)?.value).toBe(compression === "Zip" ? 8 : compression === "LZW" ? 5 : 1);
                expect(entries.get(317)?.value ?? 1).toBe(predicted ? 2 : 1);
                if (compression === "None") expect(entries.has(317)).toBe(false);
                expect(decodeImage(bytes).data).toEqual(decodeImage(input).data);
                if (compression === "Zip") {
                    const offset = entries.get(273)!.value, size = entries.get(279)!.value;
                    expect(inflateSync(bytes.subarray(offset, offset + size)).toString("hex")).toBe(predicted ? differences : literal);
                }
                // Decode compression without undoing prediction to inspect the actual LZW samples too.
                const raw = bytes.slice(), entry = entries.get(317);
                if (entry) new DataView(raw.buffer).setUint16(entry.at, 1, true);
                const pixels = decodeImage(raw).data.filter((_, index) => index % 4 !== 3);
                expect(Buffer.from(pixels).toString("hex")).toBe(predicted ? differences : literal);
            }
        });
    }
    it(`captures predictor for staged output and resets its define (${mode})`, async () => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-compress", "Zip", "-define", "tiff:predictor=1", "-write", "/plain.tif", "+define", "tiff:predictor", "/predicted.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "public" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const [path, predictor] of [["/plain.tif", 1], ["/predicted.tif", 2]] as const) {
            const bytes = mode === "public" ? await filesystem.readFile(path) : files.get(path)!;
            expect(tags(bytes).get(317)?.value ?? 1).toBe(predictor);
        }
    });
}

it.each(["Zip", "LZW"])("writes predicted TIFF to public stdout (%s)", async compression => {
    const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    await fs.writeFile("/in.ppm", input);
    const args = createCommandArguments(["/in.ppm", "-compress", compression, "-define", "tiff:predictor=2", "tiff:-"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    const bytes = new Uint8Array(Buffer.concat(chunks));
    expect(tags(bytes).get(317)?.value).toBe(2);
    expect(decodeImage(bytes).data).toEqual(decodeImage(input).data);
});
