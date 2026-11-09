import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = readFileSync(new URL("./fixtures/shear-single-input.png", import.meta.url));
// ImageMagick 7.1.2-35 Q16-HDRI: in.png -background white -shear 20 PNG32:out.png.
const native = decodeImage(readFileSync(new URL("./fixtures/shear-single-native.png", import.meta.url)));

for (const mode of ["map", "sync", "filesystem", "command"])
for (const geometry of ["20", "20x", "20x20", "20x0"])
it(`defaults only an omitted second shear angle: ${mode}, ${geometry}`, async () => {
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-background", "white", "-shear", geometry, "PNG32:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage((mode === "filesystem" || mode === "command") ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual(geometry === "20x0" ? [9, 5] : [9, 7]);
    if (geometry !== "20x0") expect(output.data).toEqual(native.data);
});
