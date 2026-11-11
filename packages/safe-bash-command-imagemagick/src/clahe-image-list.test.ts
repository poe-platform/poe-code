import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n8 8\n255\n"),
    Uint8Array.from({ length: 192 }, (_, i) => (i * 37 + 13) % 256)
]);

// ImageMagick 7.1.2-35 Q16-HDRI: in.ppm -duplicate 1 -clahe GEOMETRY -depth 8 rgb:-.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        ["2x4+32+4", "e700a4fee7cd035d58a4aac88e848ee17a37a1b93e462fc8d37257d8a97dabf4"],
        ["4x4+32+4", "9c73713b198046bcf66d36df25a5845d52b455f45c58b14681c7c602d9d10e98"],
        ["%[fx:2*n]x4+32+4", "9c73713b198046bcf66d36df25a5845d52b455f45c58b14681c7c602d9d10e98"],
        ["%[fx:2*(t+1)]x4+32+4", "9b4b8db554476928fcab5fe65883d97e70b69e5813a68f1663ba8ce272fb4fa2"],
        ["%[fx:u[1].w/2]x4+32+4", "9c73713b198046bcf66d36df25a5845d52b455f45c58b14681c7c602d9d10e98"],
        ["%[fx:w/2]x4+32+4", "9c73713b198046bcf66d36df25a5845d52b455f45c58b14681c7c602d9d10e98"]
    ])(`evaluates CLAHE geometry against the full image list (${mode}): %s`, async (geometry, hash) => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-duplicate", "1", "-clahe", geometry, "-depth", "8", "rgb:/out"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(384);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
