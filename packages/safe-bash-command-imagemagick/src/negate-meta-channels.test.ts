import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian gray samples.
const input = ["-size", "3x1", "xc:#505050", "-duplicate", "3", "(",
    "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "Meta0 rectangular region", extra: false, operations: ["-region", "1x1+0+1", "-channel", "Meta0", "-negate", "+region"], channel: "Meta0", expected: "3d717f7f4a16",
            sources: ["-size", "1x3", "xc:#505050", "-duplicate", "3", "gradient:#404040-#c0c0c0"] },
        { name: "Meta0 gradient write mask", extra: false, operations: ["-write-mask", "gradient:black-white", "-channel", "Meta0", "+negate", "+write-mask"], channel: "Meta0", expected: "bfbf35e24a16",
            sources: ["-size", "1x3", "xc:#505050", "-duplicate", "3", "gradient:#404040-#c0c0c0"] },
        { name: "unmasked gradient control", extra: false, operations: ["-channel", "Meta0", "-negate"], channel: "Meta0", expected: "bfbf7f7f3f3f",
            sources: ["-size", "1x3", "xc:#505050", "-duplicate", "3", "gradient:#404040-#c0c0c0"] },
        { name: "selected Meta0", extra: false, operations: ["-channel", "Meta0", "-negate"], channel: "Meta0", expected: "bfbf7f7f3f3f" },
        { name: "gray-only Meta0", extra: false, operations: ["-channel", "Meta0", "+negate"], channel: "Meta0", expected: "bfbf7f7f3f3f" },
        { name: "default channels", extra: false, operations: ["-negate"], channel: "Meta0", expected: "bfbf7f7f3f3f" },
        { name: "selected Meta1", extra: true, operations: ["-channel", "Meta1", "-negate"], channel: "Meta1", expected: "5f5f5f5f5f5f" },
        { name: "red leaves Meta0 unchanged", extra: false, operations: ["-channel", "R", "-negate"], channel: "Meta0", expected: "40408080c0c0" },
        { name: "Meta1 leaves Meta0 unchanged", extra: true, operations: ["-channel", "Meta1", "-negate"], channel: "Meta0", expected: "40408080c0c0" },
        { name: "Meta0 leaves red unchanged", extra: false, operations: ["-channel", "Meta0", "-negate"], channel: "R", expected: "505050505050" },
        { name: "reset default includes Meta0", extra: false, operations: ["-channel", "R", "+channel", "-negate"], channel: "Meta0", expected: "bfbf7f7f3f3f" },
        { name: "both extra planes selected", extra: true, operations: ["-channel", "Meta0,Meta1", "-negate"], channel: "Meta0,Meta1", expected: "bfbf7f7f3f3f5f5f5f5f5f5f" },
        { name: "double negate restores Meta0", extra: false, operations: ["-channel", "Meta0", "-negate", "-negate"], channel: "Meta0", expected: "40408080c0c0" },
        { name: "gray-only skips colored pixels", extra: false, operations: ["-channel", "R", "-evaluate", "Add", "1", "-channel", "Meta0", "+negate"], channel: "Meta0", expected: "40408080c0c0" },
        { name: "Q16 low bits", extra: false, operations: ["-channel", "Meta0", "-negate"], channel: "Meta0", expected: "edcb7ffe0001",
            sources: ["-size", "3x1", "xc:#505050", "-duplicate", "3", "(", "-size", "1x1", "xc:#123412341234", "xc:#800180018001", "xc:#fffefffefffe", "+append", ")"] },
        { name: "retained chunk boundary", extra: false, operations: ["-channel", "Meta0", "-negate"], channel: "Meta0", expected: "bfbf".repeat(513),
            sources: ["-size", "513x1", "xc:#505050", "-duplicate", "3", "xc:#404040"] },
    ])(`${mode}: $name`, async ({ extra, operations, channel, expected, sources = input }) => {
        const args = [...sources, ...(extra ? ["-size", "3x1", "xc:#a0a0a0"] : []), "-combine",
            ...operations, "+channel", "-channel", channel, "-separate", "+channel", "-depth", "16", "-endian", "MSB", mode === "command" ? "gray:-" : "gray:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
