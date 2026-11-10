import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Decoded PNG32 output from ImageMagick 7.1.2 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        [true, "0d346185eafe2501a7daf7964574a4f901224b75def915fb91ccef7f346595e9a4143665b0dd0be14567845d245486d9"],
        [false, "0c3e82a2eafe2501a7daf7964589c6fd012a6a8bdef915fb91ccef7f3072b4f8fb195373d1f208f479bae6671e5a9ff0"]
    ] as const)(`${mode}: matches native sigmoidal contrast with region=%s`, async (region, expected) => {
        const input = await sharp(Buffer.from("11406f85cdfc2b0189b8e77d4574a3f901305f75bdec1bf179a8d76d356493e9f1204f65addc0be16998c75d255483d9", "hex"), {
            raw: { width: 4, height: 3, channels: 4 }
        }).png().toBuffer();
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", ...(region ? ["-region", "2x2+1+0"] : []), "-sigmoidal-contrast", "5x40%", ...(region ? ["+region"] : []), "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([4, 3]);
        expect(Buffer.from(decoded.data).toString("hex")).toBe(expected);
    });
}
