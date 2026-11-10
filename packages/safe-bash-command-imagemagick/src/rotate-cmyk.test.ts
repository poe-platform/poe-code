import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff804020c0ffee231337", "hex")]);
// ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 output from the same PPM bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "CMYK", angle: "30", output: ["-depth", "8", "rgb:/out"], hash: "422c2c7ef9913abca4e73ae16bec58a065caec1ab4ab59fefb3992af499e1dc5" },
        { space: "CMYK", angle: "30", output: ["-format", "%wx%h %P %X %Y", "info:/out"], text: "5x6 5x6 -1 -2" },
        { space: "CMYK", angle: "90", output: ["-depth", "8", "rgb:/out"], hash: "03da3d3a095c728acc6a38c671ea5da08fc44f053f85534a684681269c8c7a33" },
        { space: "sRGB", angle: "30", output: ["-depth", "8", "rgb:/out"], hash: "7b7e33ca3df73f73035a9651c10968e5a1aae666fecd4da3b1a2ef128d147a36" },
    ])(`${mode}: rotates $space by $angle before converting to sRGB ($output)`, async ({ space, angle, output, hash, text }) => {
        const filesystem = new MemoryFileSystem(), files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = ["/in.ppm", "-colorspace", space, "-rotate", angle, "-colorspace", "sRGB", ...output];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const actual = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        if (hash) expect(createHash("sha256").update(actual).digest("hex")).toBe(hash);
        else expect(new TextDecoder().decode(actual)).toBe(text);
    });
}
