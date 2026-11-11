import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Buffer.from("0a1e46000a2846806e5082ff", "hex");
const input = Buffer.concat([Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), pixels]);
const native = spawnSync("magick", ["-version"]).status === 0;

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const unique of [false, true]) {
        it.each([[], ["-alpha", "discrete"], ["-alpha", "discrete", "-alpha", "activate"], ["-alpha", "deactivate"]].map(operations => ({ operations })))(`${mode}: MIFF stores alpha samples, unique=${unique}, operations=$operations`, async ({ operations }) => {
            const files = new Map([["in.pam", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pam", input);
            const argv = ["in.pam", ...operations, ...(unique ? ["-unique-colors"] : []), "-write", "mid.miff", "out.miff"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argv, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, JSON.stringify(result)).toBe(0);
            const expected = operations.includes("deactivate") ? pixels.map((value, index) => index % 4 === 3 ? 255 : value) : pixels;
            for (const name of ["mid.miff", "out.miff"]) {
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile(`/${name}`) : files.get(name)!;
                expect(Buffer.from(decodeImage(bytes).data)).toEqual(expected);
                if (native) {
                    const decoded = spawnSync("magick", ["miff:-", "-depth", "8", "rgba:-"], { input: bytes });
                    expect(decoded.status).toBe(0);
                    expect(decoded.stdout).toEqual(expected);
                }
            }
        });
    }
}
