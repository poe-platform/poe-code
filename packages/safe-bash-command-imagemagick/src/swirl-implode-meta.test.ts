import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw gray bytes after channel separation.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "swirl extra channel", operation: ["-swirl", "160"], channel: "10", expected: "3e7dbb42808c5a6e79ae8b59" },
        { name: "implode extra channel", operation: ["-implode", ".7"], channel: "10", expected: "3e7dbb4280af5d6d79ad3e6a" },
        { name: "unchanged extra channel", operation: [], channel: "10", expected: "3e7dbb4280be337179b73e6a" },
        { name: "swirl red control", operation: ["-swirl", "160"], channel: "R", expected: "143352719099b5bc0c56635d" },
        { name: "implode red control", operation: ["-implode", ".7"], channel: "R", expected: "1433527190a0a7e30c264a69" },
    ])(`${mode}: $name`, async ({ operation, channel, expected }) => {
        const input = Uint8Array.from(Array.from({ length: 12 }, (_, j) =>
            [(31 * j + 20) % 256, (73 * j + 80) % 256, (47 * j + 13) % 256, 255]).flat());
        const files = new Map([["/o.raw", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const inputs = channel === "R" ? ["rgba:/o.raw"]
            : ["rgba:/o.raw", "rgba:/o.raw", "rgba:/o.raw", "xc:white", "rgba:/o.raw", "-combine"];
        const args = ["-size", "4x3", "-depth", "8", ...inputs, ...operation,
            "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
