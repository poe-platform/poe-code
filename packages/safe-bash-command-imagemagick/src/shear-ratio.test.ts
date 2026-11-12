import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 5x3 gradient:#103050-#d0b090, RGB8 output.
const cases = [
    { geometries: ["10:20", "(10:20)", "0.5x1"], dimensions: "5x3", hash: "3642f8ed5925e2c097792772478a433104d61d9a2942d708113aa568039d021c" },
    { geometries: ["20:10", "2x1"], dimensions: "5x3", hash: "062d4e1ba1b886eb38ca87c5bed5dea7c0f66af96a909cda921ad1ae23fe3b2d" },
    { geometries: ["10", "10:"], dimensions: "6x4", hash: "958609052c380f9072ea5e3a562a45de30cc04b814c95188e4adeb45e2e5a1cd" },
    { geometries: ["20"], dimensions: "6x4", hash: "3e4f7441902ea5d56b898f839df3c9817ead5739ab386ae08bed764171458c08" },
    { geometries: ["0:20"], dimensions: "5x3", hash: "b50164206d432f348407f8a0990e4f20dd573eb79001b72e33f0670207538a3f" },
    { geometries: ["-10:20"], dimensions: "5x3", hash: "689b9b4fb5edbe6ecf0f98682ca9c9a57ef37313c6347b029188f9c3b41588e3" },
    { geometries: ["10:0"], dimensions: "22x3", hash: "b72dfc071f5a7b2b4eaf570b796d95c4db049439c34bd101208a5ff97d1fffde" },
];

for (const mode of ["map", "sync", "filesystem", "command"])
for (const { geometries, dimensions, hash } of cases)
for (const geometry of geometries)
it(`${mode}: matches native shear ratio and controls for ${geometry}`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["-size", "5x3", "gradient:#103050-#d0b090", "-shear", geometry,
        "-format", "%wx%h", "-write", "info:/dimensions.txt", "-depth", "8", "rgb:/out.rgb"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const metadata = mode === "map" || mode === "sync" ? files.get("/dimensions.txt")! : await fs.readFile("/dimensions.txt");
    const raster = mode === "map" || mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect(new TextDecoder().decode(metadata)).toBe(dimensions);
    expect(createHash("sha256").update(raster).digest("hex")).toBe(hash);
});
