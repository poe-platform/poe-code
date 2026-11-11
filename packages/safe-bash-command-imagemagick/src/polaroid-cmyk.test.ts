import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete native ImageMagick 7.1.2-35 Q16-HDRI output, including K and alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "CMYK", polaroid: true, format: "cmyka", length: 6120, pixel: "00000043af", hash: "4dc30fb76b4e0482236212c38d428381572e882eb7a222a94e9fdbf7fef1ca71" },
        { space: "CMYK", polaroid: true, format: "rgba", length: 4896, pixel: "bcbcbcaf", hash: "2e4900192f06c8033d776200d78f9ba3dd4cd15c50bcb021a0af4a4587b1fba2" },
        { space: "CMYK", polaroid: false, format: "cmyka", length: 240, pixel: "00ffff00ff", hash: "925aa38084537c3ebb587f1003022665869f5de03f99f7effab9bfaf46be8cb4" },
        { space: "sRGB", polaroid: true, format: "rgba", length: 4896, pixel: "dfdfdfaf", hash: "c373566d15ca487b1ed4de45f62e9356fd168ca26c61534c4a82450e1f7540a8" },
        { space: "CMYK", polaroid: true, format: "cmyka", options: ["-bordercolor", "#4080c0"], length: 6120, pixel: "e6970079af", hash: "d2a58953677e48986849b8c0ab2819630241a2f2eaa8ee71dd4158d925feeaea" },
        { space: "CMYK", polaroid: true, format: "cmyka", angle: "15", length: 9460, pixel: "0000000000", hash: "14bed511d13de246084e75f02b9986b64e5389fec0a18b64862c7b89909bbad1" },
        { space: "CMYK", polaroid: true, format: "cmyka", depth: "16", length: 12240, pixel: "2600260026000e43c8af", hash: "e3c06f2372243ca50a3a0586317879ba2303fb8e4ff2ddf75bcc5403a3877faa" },
    ])(`${mode}: renders $space $format (polaroid=$polaroid, angle=$angle, depth=$depth, options=$options)`, async ({ space, polaroid, format, length, pixel, hash, options = [], angle = "0", depth = "8" }) => {
        const argv = ["-seed", "7", "-size", "8x6", "xc:red", "-colorspace", space,
            ...options, ...(polaroid ? ["-polaroid", angle] : []), "-depth", depth, `${format}:/out`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(length);
        expect(Buffer.from(output.subarray(0, pixel.length / 2)).toString("hex")).toBe(pixel);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
