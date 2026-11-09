import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7 page geometry and decoded grayscale samples.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["12x9+4+3", "15", "5x4 20x18+3+2", "52424d5351501212244c4e3233355051524f4d51"],
        ["12x9+4+3", "-30", "5x6 20x27+3+1", undefined],
        ["12x9-4-3", "15", "5x4 20x18-5-4", undefined],
        ["12x9+4+3", "105", "5x6 20x27+3+1", undefined],
        ["12x9+4+3", "195", "5x4 20x18+3+2", undefined],
        ["12x9+4+3", "285", "5x6 20x27+3+1", undefined],
    ])(`preserves positioned canvas for %s rotated %s (${mode})`, async (page, angle, geometry, samples) => {
        const input = await sharp(Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(v => [v, v, v])), { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-repage", page, "-background", "#505050", "-rotate", angle, "/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect((await runMagickCli(["identify", "-format", "%wx%h %g", "/output.png"], new Map([["/output.png", output]]))).stdout).toBe(geometry);
        if (samples) expect(Buffer.from(decodeImage(output).data.filter((_, i) => i % 4 === 0)).toString("hex")).toBe(samples);
    });
}
