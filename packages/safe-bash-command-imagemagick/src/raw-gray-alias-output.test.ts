import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI: these coders write luma, not the named channel.
const coders = ["r", "g", "b", "a", "k", "c", "m", "y", "o", "gray"];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["file", "stdout", "write", "frames", "joined"] as const) {
        it.each(coders)(`${mode} ${destination}: writes grayscale bytes with %s:`, async coder => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", keep]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            // Uppercase aliases also use the shared case-insensitive coder parser.
            const pathPrefix = mode === "command" ? "" : "/";
            const target = `${destination === "write" ? coder.toUpperCase() : coder}:${destination === "stdout" ? "-" : `${pathPrefix}out${destination === "frames" ? "-%d" : ""}`}`;
            const args = [`${pathPrefix}in.pam`, ...(destination === "frames" || destination === "joined" ? ["(", `${pathPrefix}in.pam`, "-flip", ")"] : []), "-depth", "8",
                ...(destination === "write" ? ["-write", target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const paths = destination === "frames" ? ["/out-0", "/out-1"] : ["/out"];
            for (const [index, path] of paths.entries()) {
                const output = destination === "stdout"
                    ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                    : mode === "command" ? await fs.readFile(path) : files.get(path)!;
                expect(Buffer.from(output).toString("hex")).toBe(destination === "joined" ? "36b612fb087afb087a36b612" : index === 0 ? "36b612fb087a" : "fb087a36b612");
            }
            expect(mode === "command" ? (await fs.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].map(path => path.slice(1)).sort())
                .toEqual(["in.pam", "out", ...(destination === "frames" ? ["out-0", "out-1"] : [])]);
            if (destination === "stdout" || destination === "frames") expect(mode === "command" ? await fs.readFile("/out") : files.get("/out")).toEqual(keep);
        });
    }
}
