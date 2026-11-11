import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: two 16x2 frames, linked in four-byte units.
const single = "00100002000240000100000000ff000000000000";
const joined = "00100002000240000100000500ff000000000000" + single;
for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["file", "stdout", "-write", "+write", "split", "pattern"] as const) {
        it(`${mode} ${destination} preserves Palm records and their links`, async () => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const target = destination === "stdout" ? "PALM:-" : destination === "pattern" ? "/out-%d.palm" : "/out.palm";
            const args = ["-size", "16x2", "xc:black", "xc:white", "-depth", "8",
                ...(destination === "split" ? ["+adjoin"] : []),
                ...(destination === "-write" || destination === "+write" ? [destination, target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
            const read = async (path: string) => Buffer.from(mode === "command" ? await fs.readFile(path) : files.get(path)!).toString("hex");
            if (destination === "split" || destination === "pattern") {
                expect(await read("/out-0.palm")).toBe(single);
                expect(await read("/out-1.palm")).toBe(single);
                if (mode === "command") await expect(fs.stat("/out.palm")).rejects.toThrow();
                else expect(files.has("/out.palm")).toBe(false);
            } else if (destination === "stdout") expect(output.toString("hex")).toBe(joined);
            else expect(await read("/out.palm")).toBe(joined);
            if (destination !== "stdout") expect(output.length).toBe(0);
        });
    }
}
