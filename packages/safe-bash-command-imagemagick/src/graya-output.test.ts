import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const [coder, hex] of [["graya", "36ffb6801240fbbf08ff7a13"], ["gray", "36b612fb087a"]]) {
    for (const mode of ["command", "buffered", "sync"]) {
        for (const destination of ["file", "stdout", "write", "sequence", "split"]) {
            it(`${mode}: ${coder} ${destination} preserves raw samples and filenames`, async () => {
                const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const sequence = destination === "sequence" || destination === "split";
                const target = `${coder}:${destination === "stdout" ? "-" : "/out"}`;
                const args = ["/in.pam", ...(sequence ? ["(", "/in.pam", "-flip", ")"] : []), "-depth", "8",
                    ...(destination === "split" ? ["+adjoin"] : []),
                    ...(destination === "write" ? ["-write", target, "null:"] : [target])];
                const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
                }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
                const read = async (path: string) => Buffer.from(mode === "command" ? await fs.readFile(path) : files.get(path)!);
                const first = Buffer.from(hex!, "hex"), second = Buffer.concat([first.subarray(first.length / 2), first.subarray(0, first.length / 2)]);
                if (destination === "stdout") {
                    expect(Buffer.from(mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : [])).toEqual(first);
                    expect(await read("/out")).toEqual(Buffer.from("KEEP"));
                } else if (destination === "split") {
                    expect(await read("/out")).toEqual(Buffer.from("KEEP"));
                    expect(await read("/out-0")).toEqual(first);
                    expect(await read("/out-1")).toEqual(second);
                } else expect(await read("/out")).toEqual(sequence ? Buffer.concat([first, second]) : first);
                const paths = mode === "command" ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
                expect(paths.sort()).toEqual(["/in.pam", "/out", ...(destination === "split" ? ["/out-0", "/out-1"] : [])].sort());
            });
        }
    }
}
