import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, SHA-256 of each 8x7 RGB8 frame.
const hashes = {
    "-raise": [
        "2aa141f4e2fb682d74660d5d82d972dadcabdd9fdae8dd5000e12f76d8c6939f",
        "8d17c8013c42d1557981c9adc1a8e87781cb4192e83c21b6297c8fd13718942a",
    ],
    "+raise": [
        "e1f742b7c6d480a52f7a72d2550d63e8b9adebff4b03d15b15be9bd8e67f7d19",
        "189f1783601fc713a1ee6039bc8da6d3eba7ca20bba86b13dd24f9fc9d719315",
    ],
};

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const option of ["-raise", "+raise"] as const)
it.each([
    { geometry: "1x1", widths: [1, 1] },
    { geometry: "2x1", widths: [2, 2] },
    { geometry: "%[fx:n]x1", widths: [2, 2] },
    { geometry: "%[fx:t+1]x1", widths: [1, 2] },
    { geometry: "%[fx:u[1].w/4]x1", widths: [2, 2] },
    { geometry: "%[fx:w/4]x1", widths: [2, 2] },
])(`${mode}: ${option} evaluates $geometry against the full image list`, async ({ geometry, widths }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["-size", "8x7", "xc:#385060", "-duplicate", "1", option, geometry,
        "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out.rgb"];
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    const frameSize = 8 * 7 * 3;
    expect(bytes.byteLength).toBe(2 * frameSize);
    for (const [index, width] of widths.entries()) {
        expect(createHash("sha256").update(bytes.subarray(index * frameSize, (index + 1) * frameSize)).digest("hex"))
            .toBe(hashes[option][width - 1]);
    }
});
