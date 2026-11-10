import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PNG32 decoded as RGBA8.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { vibrance: "50%", before: [], after: [], rgba: "ff0083ff00ebc0ffc8007cff006964ff" },
        { vibrance: "10%", before: [], after: [], rgba: "c0703aff929479ff193153ff0a2131ff" },
        { vibrance: "50", before: [], after: [], rgba: "b9743aff949379ff173153ff0b2031ff" },
        { vibrance: undefined, before: [], after: [], rgba: "b9743aff949379ff173153ff0b2031ff" },
        { vibrance: "10%", before: ["+define", "white-balance:vibrance"], after: [], rgba: "b9743aff949379ff173153ff0b2031ff" },
        { vibrance: "10%", before: [], after: ["-define", "white-balance:vibrance=50%"], rgba: "c0703aff929479ff193153ff0a2131ff" }
    ])(`honors white-balance vibrance $vibrance via ${mode}`, async ({ vibrance, before, after, rgba }) => {
        const bytes = await sharp(Buffer.from("c07030a09070203050102030", "hex"), {
            raw: { width: 4, height: 1, channels: 3 }
        }).png().toBuffer();
        const files = new Map([["input.png", bytes]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        const args = ["input.png", ...(vibrance === undefined ? [] : ["-define", `white-balance:vibrance=${vibrance}`]), ...before, "-white-balance", ...after, "PNG32:output.png"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage((mode === "retained" || mode === "command") ? await fs.readFile("/output.png") : files.get("output.png")!);
        expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
    });
}
