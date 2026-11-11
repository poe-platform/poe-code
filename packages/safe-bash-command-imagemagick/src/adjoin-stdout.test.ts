import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const header = "6661726266656c640000000200000001";
const first = "1234abcd8001000080011235cdef8000";
const second = "80011235cdef80001234abcd80010000";
const input = Buffer.from(header + first, "hex");
// ImageMagick 7.1.2-35 Q16-HDRI: original frame followed by its horizontal flip.
const frames = [
    { coder: "FF", first: header + first, second: header + second },
    { coder: "rgba", first: "3412cdab0180000001803512efcd0080", second: "01803512efcd00803412cdab01800000" },
    { coder: "ppm", first: "50360a3220310a36353533350a1234abcd800180011235cdef", second: "50360a3220310a36353533350a80011235cdef1234abcd8001" }
];

for (const mode of ["buffered", "sync", "retained", "streamed", "command"] as const) {
    for (const destination of ["stdout", "-write", "+write", "single", "named", "adjoined"] as const) {
        it.each(frames.filter(frame => destination !== "adjoined" || frame.coder !== "FF"))(`${mode} ${destination} preserves $coder output with +adjoin`, async frame => {
            const files = new Map<string, Uint8Array>([["/in.ff", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ff", input);
            const target = `${frame.coder}:${destination === "named" ? "/out" : "-"}`;
            const args = ["/in.ff", ...(destination === "single" ? [] : ["(", "/in.ff", "-flop", ")"]),
                ...(destination === "adjoined" ? [] : ["+adjoin"]),
                ...(destination === "-write" || destination === "+write" ? [destination, target, "null:"] : [target])];
            const chunks: Uint8Array[] = [];
            const stdout = { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } };
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(), stdout,
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args,
                mode === "buffered" ? files : { filesystem: fs, cwd: "/", ...(mode === "streamed" ? { stdout } : {}) });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" || mode === "streamed" ? Buffer.concat(chunks)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
            const buffered = mode === "buffered" || mode === "sync";
            const paths = buffered ? [...files.keys()] : (await fs.readdir("/")).map(entry => `/${entry.name}`);
            if (destination === "named") {
                expect(bytes.length).toBe(0);
                expect(paths.sort()).toEqual(["/in.ff", "/out-0", "/out-1"]);
                for (const [index, expected] of [frame.first, frame.second].entries()) {
                    expect(Buffer.from(buffered ? files.get(`/out-${index}`)! : await fs.readFile(`/out-${index}`)).toString("hex")).toBe(expected);
                }
            } else {
                expect(bytes.toString("hex")).toBe(frame.first + (destination === "single" ? "" : frame.second));
                expect(paths).toEqual(["/in.ff"]);
            }
        });
    }
}
