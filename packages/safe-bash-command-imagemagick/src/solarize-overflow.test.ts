import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PNG32 input and PNG64 output.
const unchanged = "2020a0a0e0e0ffff8080c0c04040808050501010f0f040409090202040400000";
const inverted = "dfdf5f5f1f1f00007f7f3f3fbfbf7f7fafafefef0f0fbfbf6f6fdfdfbfbfffff";

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each([
        { threshold: "1e+309", expected: unchanged },
        { threshold: "-1e+309", expected: inverted },
        { threshold: "1e999%", expected: unchanged },
        { threshold: "-1e999%", expected: inverted },
        { threshold: "+1E309", expected: unchanged },
        { threshold: "1e300", expected: unchanged },
        { threshold: "-1e100", expected: inverted },
        ...["INFINITY", "Infinity", "-Infinity", "+Infinity", "inf", "NaN", "1e309junk", "1e309%junk", "1e+"].map(threshold => ({ threshold, expected: undefined })),
    ])(`${mode}: matches native overflowing solarize threshold $threshold`, async ({ threshold, expected }) => {
        const input = await sharp(Buffer.from("20a0e0ff80c040805010f04090204000", "hex"), {
            raw: { width: 4, height: 1, channels: 4 }
        }).png().toBuffer();
        const original = Buffer.from("KEEP");
        const files = new Map([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.png", "-solarize", threshold, "PNG64:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (expected === undefined) {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument '-solarize'");
            expect([...output]).toEqual([...original]);
        } else {
            expect(result.exitCode).toBe(0);
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height, decoded.depth]).toEqual([4, 1, "ushort"]);
            const bytes = Buffer.from(expected, "hex");
            expect([...decoded.data16!]).toEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readUInt16BE(i * 2)));
        }
    });
}
