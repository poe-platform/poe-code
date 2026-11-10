import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI, little-endian raw exports.
const fixtures = [
    { coder: "rgbo", hex: "ff00000000ff00000000ff00fdfbf90008080800627f9100" },
    { coder: "bgro", hex: "0000ff00ff00ff0000f9fbfd080808917f62" },
    { coder: "gray", hex: "36b612fb087a" }
];
for (const mode of ["command", "buffered", "sync"] as const) {
    for (const coderCase of ["lower", "upper"]) {
        for (const destination of ["file", "stdout", "-write", "split", "plane", "line", "partition"] as const) {
            it.each(fixtures.filter(fixture => !["plane", "line", "partition"].includes(destination) || fixture.coder !== "gray"))(`${mode} ${coderCase} ${destination}: $coder`, async ({ coder, hex }) => {
                const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const target = `${coderCase === "upper" ? coder.toUpperCase() : coder}:${destination === "stdout" ? "-" : "/out"}`;
                const args = ["/in.pam", "(", "/in.pam", "-flip", ")", "-depth", "8",
                    ...(destination === "split" ? ["+adjoin"] : ["plane", "line", "partition"].includes(destination) ? ["-interlace", destination] : []),
                    ...(destination === "-write" ? ["-write", target, "null:"] : [target])];
                const stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                if (mode === "command") await expect(fs.stat(`/${target}`)).rejects.toMatchObject({ code: "ENOENT" });
                else expect(files.has(target)).toBe(false);
                let first = Buffer.from(hex, "hex");
                if (destination === "plane") first = Buffer.from("ff0000fd086200ff00fb087f0000fff90891", "hex");
                if (destination === "line") first = Buffer.from(coder === "rgbo" ? "ff000000ff000000ff000000fd0862fb087ff90891000000" : "0000ff00ff00ff0000f90891fb087ffd0862", "hex");
                const second = destination === "plane" ? Buffer.from("fd0862ff0000fb087f00ff00f908910000ff", "hex") : Buffer.concat([first.subarray(first.length / 2), first.subarray(0, first.length / 2)]);
                const read = async (path: string) => Buffer.from(mode === "command" ? await fs.readFile(path) : files.get(path)!);
                if (destination === "split") {
                    expect(await read("/out")).toEqual(Buffer.from("KEEP"));
                    expect(await read("/out-0")).toEqual(first);
                    expect(await read("/out-1")).toEqual(second);
                } else if (destination === "partition") {
                    const channels = coder === "rgbo" ? "RGB" : "BGR";
                    const packed = Buffer.concat([first, second]);
                    for (const [channel, suffix] of [...channels].entries()) {
                        const expected = Uint8Array.from({ length: 12 }, (_, pixel) => packed[pixel * (coder === "rgbo" ? 4 : 3) + channel]!);
                        expect(await read(`/out.${suffix}`)).toEqual(Buffer.from(expected));
                    }
                    expect(await read("/out")).toEqual(Buffer.from("KEEP"));
                } else if (destination === "stdout") {
                    expect(Buffer.from(mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array())).toEqual(Buffer.concat([first, second]));
                } else expect(await read("/out")).toEqual(Buffer.concat([first, second]));
            });
        }
    }
}
