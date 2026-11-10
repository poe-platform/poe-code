import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 rejects these Line inputs and leaves out untouched.
for (const mode of ["command", "sync"] as const) {
    for (const [coder, input, packed] of [
        ["gray", "1f364d64", "1f1f1fff363636ff4d4d4dff646464ff"],
        ["graya", "1f364d647b92a9c0", "1f1f1f364d4d4d647b7b7b92a9a9a9c0"]
    ] as const) {
        it.each([
            { options: ["-interlace", "Line"], fails: true },
            ...(coder === "graya" ? [{ options: ["-interlace", "Line"], fails: false, source: "1f364d64000000007b92a9c000000000", expected: "1f1f1f4d363636647b7b7ba9929292c0" }] : []),
            { options: ["-interlace", "None"], fails: false },
            { options: ["-interlace", "Line", "+interlace"], fails: false }
        ])(`preserves output on invalid ${coder} input (${mode}, $options)`, async (testCase) => {
            const { options, fails } = testCase;
            const argv = ["-size", "2x2", "-depth", "8", ...options, `${coder}:/in.data`, "-interlace", "None", "-depth", "8", "rgba:/out"];
            const files = new Map<string, Uint8Array>([["/in.data", Buffer.from("source" in testCase ? testCase.source : input, "hex")], ["/out", new TextEncoder().encode("KEEP")]]);
            let exitCode: number, stderr = "";
            if (mode === "sync") {
                ({ exitCode, stderr } = runMagickCliSync(argv, files));
            } else {
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const args = createCommandArguments(argv);
                ({ exitCode } = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }));
                expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["in.data", "out"]);
                files.set("/out", await fs.readFile("/out"));
            }
            expect(Buffer.from(files.get("/out")!).toString("hex")).toBe(fails ? "4b454550" : "expected" in testCase ? testCase.expected : packed);
            expect(exitCode).toBe(fails ? 1 : 0);
            if (fails) expect(stderr).not.toBe("");
            else expect(stderr).toBe("");
            expect([...files.keys()].sort()).toEqual(["/in.data", "/out"]);
        });
    }
}
