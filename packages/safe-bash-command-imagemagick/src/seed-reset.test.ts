import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64");
// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1; decoded RGBA SHA-256.
const cases = [
    { options: ["-seed", "17", "+seed", "-seed", "2"], expected: "cf9d8b529335993b6fb2ca37feb70456ccb302083fe0e13547941ca06087b84a" },
    { options: ["-seed", "17", "+seed", "-seed", "17"], expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { options: ["+seed", "-seed", "2"], expected: "cf9d8b529335993b6fb2ca37feb70456ccb302083fe0e13547941ca06087b84a" },
    { options: ["-seed", "2", "+seed"], expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { options: ["+seed"], expected: "4068f27fcc045c2edf339092db29a47ecc96a907cc8d1e754f099a7edab00c14" },
    { options: ["+seed", "-seed", "bad"], expected: undefined },
];

afterEach(() => vi.restoreAllMocks());

for (const mode of ["command", "retained", "buffered", "sync", "mogrify-command", "mogrify-retained", "mogrify-sync"] as const) {
    it.each(cases)(`${mode}: applies seed settings in order: $options`, async ({ options, expected }) => {
        // +seed uses whole Unix seconds; the reset-only cases therefore use seed 17.
        vi.spyOn(Date, "now").mockReturnValue(17_999);
        const mogrify = mode.startsWith("mogrify-");
        const original = mogrify ? new Uint8Array(input) : new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = mogrify
            ? [...options, "-random-threshold", "0x100%", "/out.png"]
            : ["/in.png", ...options, "-random-threshold", "0x100%", "PNG32:/out.png"];
        let stderr = "";
        const args = createCommandArguments(mode === "mogrify-command" ? ["mogrify", ...argv] : argv);
        const result = mode === "command" || mode === "mogrify-command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "mogrify-sync" ? runMogrifyCliSync(argv, files)
            : mode === "mogrify-retained" ? await runMogrifyCli(argv, { filesystem: fs, cwd: "/" })
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const bytes = mode === "buffered" || mode.endsWith("sync") ? files.get("/out.png")! : await fs.readFile("/out.png");
        if (expected === undefined) {
            expect(result.exitCode).toBe(1);
            expect(bytes).toEqual(original);
        } else {
            expect(result.exitCode, stderr).toBe(0);
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([8, 6]);
            expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
        }
    });
}
