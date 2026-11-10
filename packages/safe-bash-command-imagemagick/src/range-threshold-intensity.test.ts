import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Decoded RGBA hashes from ImageMagick 7.1.2-35 Q16-HDRI on the 8x6 color fixture.
// Additional intensity and channel cases verified with 7.1.2-31 Q16-HDRI.
for (const mode of ["magick", "buffered", "retained", "sync"] as const) {
    it.each([
        [[], "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7"],
        [["-intensity", "Brightness"], "80e7f89a6fba237aad695f6c5b9f1583c7dad16552f925ba94b1ae6c014acf3b"],
        [["-intensity", "Average"], "78540d0aa0a31a9e43109f69e82581ac6b6ab611c8ad0a4b1627d2eb7fb41662"],
        [["-intensity", "RMS"], "fd48fb4492078f73d481dc0b48ec122bd4d85fd637671d5fbfe12f9c2158e799"],
        [["-intensity", "Rec601Luma"], "626154121fc084e296545a16d3161d21ffe77fd406693266182777ca82b6c1e4"],
        [["-intensity", "Rec709Luma"], "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7"],
        [["-intensity", "Brightness", "+intensity"], "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7"],
        [["-intensity", "Lightness"], "30bfa3c6d18ae4eb05493ec09fce0cb543b8845f2dea9fc1d8630f981535eb86"],
        [["-intensity", "MS"], "50e0d32d009aa716dce56e99a9cc59d0c2707f6238adaebad43a1904f8d207fc"],
        [["-intensity", "Rec601Luminance"], "3ec43c3048f6af614bf20f0b9d486f240897ca139e30941131e30c6a9d1a9665"],
        [["-intensity", "Rec709Luminance"], "023fe9c7c78ec669270f48d7a7aa78720a32deae6a3e42d500b7b230cd2cc393"],
        [["-intensity", "Brightness", "-channel", "RGB"], "60fb81cb5bc7ef1ed9c86a3587274b1e82ec551e5ab5d74ce061e99e2a221a36"],
        [["-intensity", "Brightness", "-channel", "R"], "fc666f243d41746d9d34a474f67b736c564c396fe7e7c7dde894ff0dd30473de"],
        [["-intensity", "Brightness", "-channel", "A"], "f5c93b02a98e0d797e63e705e6e8cdf4fc077c7ab15eafa7e7d5c12db6f80efa"],
    ] as [string[], string][])(`${mode}: range threshold honors %j`, async (settings, expected) => {
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64");
        const files = new Map([["/in.png", input], ["/out.png", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        const argv = ["/in.png", "-seed", "17", ...settings, "-range-threshold", "10,30,60,90%", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "magick" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "magick" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
    });
}
