import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI uses a 1e-12 quantum-unit gray tolerance.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const channel of ["R", "G", "B"]) {
        for (const meta of [false, true]) {
            it.each([
                { amount: "1e-13", expected: "ffffff" },
                { amount: "1e-9", expected: "000000" },
                { amount: "0", expected: "ffffff" },
            ])(`${mode}: +negate after adding $amount to ${channel} (meta=${meta})`, async ({ amount, expected }) => {
                const argv = ["xc:black", ...(meta ? ["-duplicate", "4", "-combine"] : []),
                    "-channel", channel, "-evaluate", "Add", amount, "+channel", "+negate",
                    ...(meta ? ["-channel", "Meta0", "-separate", "+channel"] : []),
                    "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argumentValues = createCommandArguments(argv);
                const stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", fs,
                    env: { LC_ALL: "C", MAGICK_THREAD_LIMIT: "1" },
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
                const output = mode === "command" ? Buffer.concat(stdout)
                    : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(Buffer.from(output).toString("hex")).toBe(expected);
            });
        }
    }
}
