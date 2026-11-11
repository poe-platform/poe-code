import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("404080207f8081800080ff00fea09fff", "hex");

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA bytes.
for (const mode of ["sync", "buffered", "retained", "magick", "convert"] as const) {
    it.each([
        { region: ["-region", "2x1+1+0"], alpha: [], expected: "02020420000000ff000000fffea09fff" },
        { region: ["-region", "2x1+1+0"], alpha: ["-alpha", "on"], expected: "02020420000000ff000000fffea09fff" },
        { region: [], alpha: ["-alpha", "on"], expected: "000000ff000000ff000000ffffffffff" },
        { region: ["-region", "1x1+0+0"], alpha: [], expected: "000000ff3030318000000000fea09fff" },
        { region: ["-region", "2x1+1+0"], range: "#00000000-#ffffffff", alpha: [], expected: "e1e1e320fffffffffffffffffea09fff" },
        { region: ["-region", "2x1+1+0", "-channel", "R"], alpha: [], expected: "e1ffff20fffffffffffffffffeffffff" },
        { region: ["-region", "2x1+1+0", "-alpha", "off"], alpha: ["-alpha", "on"], expected: "404080fffffffffffffffffffea09fff" },
        { region: ["-region", "2x1+1+0"], alpha: ["-color-threshold", "black-white"], expected: "00000020fffffffffffffffffea09fff" },
        { region: ["-region", "2x1+1+0"], alpha: [], depth: "16", expected: "01e601e603cb2020000000000000ffff000000000000fffffefea0a09f9fffff" },
        { region: ["-region", "5x1+508+1"], alpha: [], size: "513x2", depth: "16", expected: "d2887128030198ab5901e9dc7886a902e954c26d286b78551e2cbacfa0779104" },
    ])(`${mode}: color threshold with $region $alpha`, async ({ region, alpha, expected, range = "black-white", depth = "8", size = "4x1" }) => {
        const fs = new MemoryFileSystem();
        const pixels = size === "4x1" ? input : Buffer.concat(Array.from({ length: 257 }, () => input)).subarray(0, 513 * 2 * 4);
        await fs.writeFile("/in.raw", pixels);
        const files = new Map<string, Uint8Array>([["/in.raw", pixels]]);
        const stdout: Uint8Array[] = [];
        const command = mode === "magick" || mode === "convert";
        const argv = ["-size", size, "-depth", "8", "rgba:/in.raw", ...region, "-color-threshold", range, ...alpha, "+region", "-depth", depth, "-endian", "MSB", command ? "rgba:-" : "rgba:/out.raw"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = command ? Buffer.concat(stdout) : mode === "sync" || mode === "buffered" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        expect(size === "4x1" ? Buffer.from(output).toString("hex") : createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
