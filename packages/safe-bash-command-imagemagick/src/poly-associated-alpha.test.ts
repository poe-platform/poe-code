import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference pixels, RGBA16 big-endian.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { alpha: ["Associate"], source: 1, expected: "74664f202f65b7f7" },
        { alpha: ["Associate"], source: 0, expected: "8ad1552428aeffff" },
        { alpha: ["Disassociate"], source: 1, expected: "ada770063c5eb7f7" },
        { alpha: ["Disassociate"], source: 0, expected: "956c71bc51baffff" },
        { alpha: ["Associate", "Deactivate"], source: 1, expected: "74664f202f651c1c" },
        { alpha: ["Disassociate", "Deactivate"], source: 1, expected: "ada770063c5e1c1c" },
        { alpha: [], source: -1, expected: "8e0e5dde3535b7f7" },
    ])(`${mode}: poly with $alpha on source $source`, async ({ alpha, source, expected }) => {
        const argv = ["xc:#173e5970", "xc:#b56829cf"].flatMap((input, index) =>
            index === source ? ["(", input, ...alpha.flatMap(value => ["-alpha", value]), ")"] : [input]);
        argv.push("-poly", "0.25,1,0.75,1", "-depth", "16", "-endian", "MSB", "rgba:-");
        const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
