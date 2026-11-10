import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 4\nHEIGHT 3\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"),
    Uint8Array.from({ length: 48 }, (_, i) => (i * 53 + 9) % 256)
]);
// ImageMagick 7.1.2-35 Q16-HDRI: ink.pam <options> -depth 8 <coder>:out.
const cases = [
    { coder: "cmyk", options: [], size: 48, sha256: "42f201293a2639aa7dd08f8872d9f43f6da01c15afc60738c6be0b049102048c" },
    { coder: "CMYKA", options: [], size: 60, sha256: "b3d990f0de43a7b015cbbcffe1ba9003fbad18d0933ea9fe5ba6dc45d94316e2" },
    { coder: "rgb", options: ["-colorspace", "sRGB"], size: 36, sha256: "6c30ac44cfda5221511faef9741ad4299633cab25d190172dff7c2e4327350c8" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["file", "stdout", "write"] as const) {
        it.each(cases)(`${mode} ${destination}: writes $coder to the requested destination`, async ({ coder, options, size, sha256 }) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/ink.pam", input], ["/out", keep]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const target = `${coder}:${destination === "stdout" ? "-" : "/out"}`;
            const args = ["/ink.pam", ...options, "-depth", "8", ...(destination === "write" ? ["-write", target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = destination === "stdout"
                ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                : mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(output.length).toBe(size);
            expect(createHash("sha256").update(output).digest("hex")).toBe(sha256);
            expect(mode === "command" ? (await fs.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].map(path => path.slice(1)).sort()).toEqual(["ink.pam", "out"]);
            if (destination === "stdout") expect(mode === "command" ? await fs.readFile("/out") : files.get("/out")).toEqual(keep);
            else expect(mode === "command" ? Buffer.concat(stdout).length : "stdout" in result ? result.stdout : "").toBe(mode === "command" ? 0 : "");
        });
    }
}

for (const mode of ["sync", "retained"] as const) {
    for (const depth of [8, 16]) {
        it.each(["None", "Line", "Plane"])(`${mode}: preserves CMYK alpha, depth ${depth} and chunk boundaries with %s interlace`, async interlace => {
            const width = 1031, height = 2, sampleBytes = depth / 8;
            const pixels = Uint8Array.from({ length: width * height * 5 * sampleBytes }, (_, i) => (i * 43 + 19) % 256);
            const pam = Buffer.concat([Buffer.from(`P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 5\nMAXVAL ${depth === 8 ? 255 : 65535}\nTUPLTYPE CMYK_ALPHA\nENDHDR\n`), pixels]);
            const files = new Map<string, Uint8Array>([["/in.pam", pam]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.pam", pam);
            const args = ["/in.pam", "-depth", String(depth), "-interlace", interlace, "-endian", "MSB", "-write", "CmYk:/inks", "-endian", "LSB", "/out.CMYKA"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "" });
            for (const channels of [4, 5]) {
                const expected: number[] = [];
                const rows = interlace === "Line" ? height : 1, rowPixels = width * height / rows;
                for (let row = 0; row < rows; row++) {
                    for (let channel = 0; channel < (interlace === "None" ? 1 : channels); channel++) {
                        for (let pixel = row * rowPixels; pixel < (row + 1) * rowPixels; pixel++) {
                            for (let c = channel; c < (interlace === "None" ? channels : channel + 1); c++) {
                                const offset = (pixel * 5 + c) * sampleBytes;
                                expected.push(...pixels.subarray(offset, offset + sampleBytes));
                            }
                        }
                    }
                }
                const path = channels === 4 ? "/inks" : "/out.CMYKA";
                const bytes = mode === "sync" ? files.get(path)! : await fs.readFile(path);
                expect(Buffer.from(bytes)).toEqual(channels === 5 && depth === 16 ? Buffer.from(expected).swap16() : Buffer.from(expected));
            }
        });
    }
    it.each([false, true])(`${mode}: converts RGB to CMYKA with inactive alpha=%s`, async inactive => {
        const pam = Buffer.concat([Buffer.from("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from("2040608000000000", "hex")]);
        const files = new Map<string, Uint8Array>([["/in.pam", pam]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", pam);
        const args = ["/in.pam", ...(inactive ? ["-alpha", "off"] : []), "-depth", "8", "cmyka:-"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(inactive ? "aa55009fff000000ffff" : "aa55009f80000000ff00");
    });
}
