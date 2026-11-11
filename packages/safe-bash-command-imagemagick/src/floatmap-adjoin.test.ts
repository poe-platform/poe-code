import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: two reads, with the second flopped.
const input = Buffer.from("50660a3220310a312e300a3e0000003f000000", "hex");
const fixtures = [
    { format: "pfm", first: "50660a3220310a312e300a3e0000003f000000", second: "50660a3220310a312e300a3f0000003e000000" },
    { format: "phm", first: "50680a3220310a312e300a30003800", second: "50680a3220310a312e300a38003000" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["stdout", "file", "write-stdout", "write-file", "split", "pattern", "single"] as const) {
        it.each(fixtures)(`writes every $format frame in order (${mode}, ${destination})`, async ({ format, first, second }) => {
            const files = new Map<string, Uint8Array>([["/in.pfm", input], ["/out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const target = `${format}:${destination.includes("stdout") || destination === "single" ? "-" : destination === "pattern" ? "/out-%d" : "/out"}`;
            const args = ["/in.pfm", ...(destination === "single" ? [] : ["(", "/in.pfm", "-flop", ")"]),
                ...(destination === "split" ? ["+adjoin"] : []),
                ...(destination.startsWith("write-") ? ["-write", target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const read = async (path: string) => Buffer.from(mode === "command" ? await fs.readFile(path) : files.get(path)!).toString("hex");
            if (destination === "split" || destination === "pattern") {
                expect(await read("/out-0")).toBe(first);
                expect(await read("/out-1")).toBe(second);
                expect(await read("/out")).toBe(Buffer.from("KEEP").toString("hex"));
            } else if (target.endsWith(":-")) {
                const bytes = mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
                expect(Buffer.from(bytes).toString("hex")).toBe(first + (destination === "single" ? "" : second));
            } else expect(await read("/out")).toBe(first + second);
        });
    }
}
