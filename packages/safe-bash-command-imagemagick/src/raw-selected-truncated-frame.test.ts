import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI accepts complete selected frames before a partial tail.
for (const mode of ["file", "stream", "sync", "buffered", "retained"] as const) {
    it.each([
        { selector: "[0]", length: 30, expected: "0102030405060708090a0b0c" },
        { selector: "[1]", length: 30, expected: "0d0e0f101112131415161718" },
        { selector: "[0-1]", length: 30, expected: "0102030405060708090a0b0c0d0e0f101112131415161718" },
        { selector: "[1]", length: 24, expected: "0d0e0f101112131415161718" },
        { selector: "", length: 30, expected: undefined },
        { selector: "[2]", length: 30, expected: undefined },
        { selector: "[0-2]", length: 30, expected: undefined },
    ])(`${mode} reads $selector from $length bytes`, async ({ selector, length, expected }) => {
        const input = Uint8Array.from({ length }, (_, index) => index + 1);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.bin", input], ["/out.rgb", keep]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-size", "2x2", "-depth", "8", `rgb:${mode === "stream" ? "-" : "/in.bin"}${selector}`, "rgb:/out.rgb"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const command = mode === "file" || mode === "stream";
        const result = command ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        const output = command || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
        expect(result.exitCode).toBe(expected === undefined ? 1 : 0);
        if (expected === undefined) expect(stderr).toContain("unexpected end-of-file in RGB input");
        else expect(stderr).toBe("");
        expect(Buffer.from(output).toString("hex")).toBe(expected ?? Buffer.from(keep).toString("hex"));
    });
}
