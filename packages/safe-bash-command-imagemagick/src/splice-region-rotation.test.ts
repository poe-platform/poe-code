import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI with a zero-initialized disk cache
// (-limit memory 0 -limit map 0). Its in-memory rotation reads uninitialized
// destination mask samples, so allocator-dependent pixels are not a reference.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "active-region rotation", operations: ["-rotate", "90"], hash: "b84fb23830a78adc41bc728652fb4774fcbd15b56e014acc6487ccf2ab06f5d8" },
        { name: "cleared-region rotation", operations: ["+region", "-rotate", "90"], hash: "b84fb23830a78adc41bc728652fb4774fcbd15b56e014acc6487ccf2ab06f5d8" },
        { name: "splice alone", operations: [], hash: "47473174d4b4d88c1e7dcfad19580b67f5759c8c8a0ea921bf30e9be398c9b9b" },
        { name: "negate after splice", operations: ["-negate"], hash: "6fe954e0646a3b7695034249a25fb1357fb6b065279baf797ef9c8585da22341" },
    ])(`${mode}: preserves centered splice pixels for $name`, async ({ operations, hash }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "5x4", "xc:steelblue", "-region", "3x2+1+1", "-background", "#ff220080",
            "-gravity", "Center", "-splice", "1x1+1+0", ...operations, "-depth", "8", "rgba:/out"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(bytes).toHaveLength(5 * 6 * 4);
        expect([...bytes.subarray(48, 52)]).toEqual([70, 130, 180, 255]);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
