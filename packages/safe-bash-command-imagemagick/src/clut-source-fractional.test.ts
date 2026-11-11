import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including unmodified source controls.
for (const mode of ["map", "sync", "filesystem", "command"])
for (const png of [false, true])
for (const multiply of [false, true])
for (const lookup of ["clut", "hald-clut", "scaled-clut"]) {
    it(`${mode}: ${lookup} retains source precision (png=${png}, multiply=${multiply})`, async () => {
        const depth = lookup === "scaled-clut" ? 8 : 16;
        const expected = depth === 8 ? multiply ? "102041ff" : "102040ff"
            : multiply ? "207240e481c9ffff" : "202040408080ffff";
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = ["-respect-parentheses", "(", lookup === "hald-clut" ? "xc:#20408080" : "xc:#204080",
            ...(multiply ? ["-evaluate", "Multiply", "1.01"] : []), ")", "(",
            ...(lookup === "hald-clut" ? ["hald:2"] : ["xc:black", "xc:white", "+append"]),
            ...(lookup === "scaled-clut" ? ["-evaluate", "Multiply", "0.501"] : []), ")",
            lookup === "hald-clut" ? "-hald-clut" : "-clut", "-depth", String(depth), "-endian", "MSB",
            `${png ? depth === 8 ? "PNG32" : "PNG64" : "rgba"}:/out`];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        if (png) {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([1, 1]);
            const bytes = Buffer.from(expected, "hex");
            expect(Array.from(image.data16 ?? image.data)).toEqual(depth === 8 ? [...bytes]
                : Array.from({ length: 4 }, (_, channel) => bytes.readUInt16BE(channel * 2)));
        } else expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
