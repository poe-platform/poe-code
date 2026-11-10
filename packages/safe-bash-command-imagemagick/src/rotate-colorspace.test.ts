import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff804020c0ffee231337", "hex")]);
// ImageMagick 7.1.2-35 Q16-HDRI: in.ppm -colorspace SPACE -rotate ANGLE
// -colorspace sRGB -depth 8 rgb:out (or -format '%wx%h %P %X %Y' info:out).
const cases = [
    { space: "HSL", angle: "30", hash: "229cfb6f88df7859b92a1e1a49fa2c48c57e79efaaecf8faffed418b945d5833" },
    { space: "HSL", angle: "30", info: "5x6 5x6 -1 -2" },
    { space: "HSL", angle: "90", hash: "03da3d3a095c728acc6a38c671ea5da08fc44f053f85534a684681269c8c7a33" },
    { space: "sRGB", angle: "30", hash: "7b7e33ca3df73f73035a9651c10968e5a1aae666fecd4da3b1a2ef128d147a36" },
    { space: "Lab", angle: "30", hash: "a867ac23a6adc04e62d902ca8088b0840de5dbcbb1f43df3166d2da08bda5499" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: resamples $space at $angle degrees ($info)`, async ({ space, angle, hash, info }) => {
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", "-colorspace", space, "-rotate", angle, "-colorspace", "sRGB",
            ...(info ? ["-format", "%wx%h %P %X %Y", "info:/out"] : ["-depth", "8", "rgb:/out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        if (info) expect(new TextDecoder().decode(output)).toBe(info);
        else expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
