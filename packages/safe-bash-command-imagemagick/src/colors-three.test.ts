import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const inputs = {
    rgb: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAEklEQVR4nGP4z8DAAMb//zMAABzwBPyZ0exRAAAAAElFTkSuQmCC",
    indexed: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg=="
};

for (const mode of ["command", "sync"] as const) for (const [format, encoded] of Object.entries(inputs)) {
    for (const dither of [[], ["+dither"], ["-dither", "None"]]) for (const colors of [2, 3, 4]) {
        it(`reduces saturated colors to at most ${colors}: ${format}, ${mode}, ${dither.join(" ") || "default dither"}`, async () => {
            // ImageMagick 7.1.2-35 Q16-HDRI: in.png [dither] -colors N -depth 8 rgba:-.
            // Both two- and three-color limits merge red, lime and yellow; blue stays separate.
            const input = Buffer.from(encoded, "base64"), fs = new MemoryFileSystem();
            const files = new Map([["/in.png", input]]);
            await fs.writeFile("/in.png", input);
            const args = ["/in.png", ...dither, "-colors", String(colors), "/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : runConvertCliSync(args, files);
            if ("stderr" in result) stderr += result.stderr;
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([4, 1]);
            expect([...output.data]).toEqual(colors === 4
                ? [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]
                : [170, 170, 0, 255, 170, 170, 0, 255, 0, 0, 255, 255, 170, 170, 0, 255]);
        });
    }
}
