import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["file", "stream", "sync"] as const) {
    for (const coder of ["rgb", "gray"] as const) {
        it.each(["offset", "control", "truncated"] as const)(`reads ${coder} size byte offset via ${mode}: %s`, async kind => {
            const hex = coder === "rgb" ? "093e73a8dd12477cb1e61b5085baef" : "093e73a8dd1247";
            const input = Buffer.from(kind === "offset" ? hex : hex.slice(0, -6), "hex");
            const expected = coder === "rgb"
                ? kind === "offset" ? "a8dd12ff477cb1ffe61b50ff85baefff" : "093e73ffa8dd12ff477cb1ffe61b50ff"
                : kind === "offset" ? "a8a8a8ffddddddff121212ff474747ff" : "090909ff3e3e3eff737373ffa8a8a8ff";
            const argv = ["-size", kind === "control" ? "2x2" : "2x2+3", "-depth", "8", `${coder}:${mode === "stream" ? "-" : "raw.bin"}`, "-append", "-depth", "8", "rgba:out"];
            let result: { exitCode: number }, stderr = "", output: Uint8Array;
            if (mode === "sync") {
                const files = new Map<string, Uint8Array>([["raw.bin", input], ["out", Buffer.from("KEEP")]]);
                const sync = runMagickCliSync(argv, files);
                result = sync;
                stderr = sync.stderr;
                output = files.get("out")!;
            } else {
                const fs = new MemoryFileSystem();
                await fs.writeFile("/raw.bin", input);
                await fs.writeFile("/out", Buffer.from("KEEP"));
                const args = createCommandArguments(argv);
                result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal,
                    stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                output = await fs.readFile("/out");
            }
            expect(result.exitCode).toBe(kind === "truncated" ? 1 : 0);
            if (kind === "truncated") expect(stderr).toContain("unexpected end-of-file");
            else expect(stderr).toBe("");
            expect(Buffer.from(output).toString("hex")).toBe(kind === "truncated" ? "4b454550" : expected);
        });
    }
}
