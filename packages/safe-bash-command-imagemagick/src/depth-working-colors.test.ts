import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI command-boundary results.
const input = Buffer.from("d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080", "hex");
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const space of ["Lab", "XYZ"] as const) {
        it.each([
            { depth: undefined, channel: undefined, copies: 1 },
            { depth: 8, channel: undefined, copies: 1 },
            { depth: 16, channel: undefined, copies: 1 },
            { depth: 8, channel: "A", copies: 1 },
            { depth: 8, channel: "RGB", copies: 1 },
            { depth: 8, channel: undefined, copies: 65 },
        ])(`${mode}: converts ${space} back to sRGB after depth $depth, channel $channel, copies $copies`, async ({ depth, channel, copies }) => {
            const fs = new MemoryFileSystem();
            const files = new Map([["/in.raw", new Uint8Array(Buffer.concat(Array.from({ length: copies }, () => input)))], ["/out", new TextEncoder().encode("KEEP")]]);
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = [
                ...(space === "Lab" ? ["-size", `${copies}x1`, "xc:#2170b180"] : ["-size", `4x${2 * copies}`, "-depth", "8", "rgba:/in.raw"]),
                "-colorspace", space, ...(channel ? ["-channel", channel] : []), ...(depth === undefined ? [] : ["-depth", String(depth)]),
                "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"
            ];
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                    stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            const quantized = depth === 8 && channel !== "A";
            const expected = space === "Lab" ? quantized ? "2270b280" : "2170b180"
                : quantized ? "d03190801f70b0ff622f20ff20a03fff0624c080622f20ffd0319080a10a0f80" : input.toString("hex");
            expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(copies));
        });
    }
}
