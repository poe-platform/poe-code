import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;

// ImageMagick 7.1.2-35 Q16-HDRI, unsigned MIFF decoded to big-endian RGBA16.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
for (const intermediate of [false, true])
it.each([undefined, 16, 8])(`preserves interpolated MIFF samples (${mode}, intermediate=${intermediate}, depth=%s)`, async depth => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const operation = ["xc:#1e423966", "xc:#b56a9287", "-morph", "2", "-delete", "0,2,3",
        ...(depth === undefined ? [] : ["-depth", String(depth)]), "-define", "quantum:format=unsigned"];
    const destination = mode === "command" ? "miff:-" : "/out.miff";
    const args = [...operation, ...(intermediate ? ["-write", destination, "null:"] : [destination])];
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, stderr).toBe(0);
    const output = mode === "command" ? Buffer.concat(stdout) : mode === "filesystem" ? await fs.readFile("/out.miff") : files.get("/out.miff")!;
    const header = new TextDecoder().decode(output.subarray(0, output.indexOf(26)));
    expect(header).toContain(`depth=${depth ?? 16}\n`);
    const expected = depth === 8 ? "50504f4f57577171" : "50a64fa557017171";
    const decoded = decodeImage(output);
    const samples = decoded.data16 ?? Uint16Array.from(decoded.data, value => value * 257);
    expect([...samples]).toEqual(Array.from({ length: 4 }, (_, index) => Buffer.from(expected, "hex").readUInt16BE(index * 2)));
    if (nativeMagick) {
        const reference = spawnSync("magick", [...operation, "miff:-"]);
        expect(reference.status, reference.stderr.toString()).toBe(0);
        for (const input of [reference.stdout, output]) {
            const readback = spawnSync("magick", ["miff:-", "-depth", "16", "-endian", "MSB", "rgba:-"], { input });
            expect(readback.status, readback.stderr.toString()).toBe(0);
            expect(readback.stdout.toString("hex")).toBe(expected);
        }
    }
});
