import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: sample only the original footprint.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
    for (const operation of ["-frame", "-border"])
        it.each([
            { compose: "Clear", expected: "000000" },
            { compose: "Src", expected: "2080c0" },
            { compose: "Over", expected: "082030" },
            { compose: "Dst", expected: "000000" },
            { compose: "Multiply", expected: "000000" },
            { compose: "Plus", expected: "082030" },
            { compose: "Xor", expected: "000000" },
            { compose: "Src", channel: "R", expected: "000000" },
            { compose: "Src", channel: "Meta0", expected: "2080c0" },
            { compose: "Clear", depth: 16, expected: "000000000000" },
            { compose: "Src", depth: 16, expected: "20208080c0c0" },
            { compose: "Over", depth: 16, expected: "081020403060" },
        ])(`${mode} ${operation}: composes Meta0 with $compose (channel=$channel, depth=$depth)`, async ({ compose, expected, channel, depth = 8 }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "3x1", "xc:#404040", "-duplicate", "3",
                "(", "+size", "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine",
                "-mattecolor", "#507090", "-bordercolor", "#806020",
                ...(channel ? ["-channel", channel] : []), "-compose", compose, operation, "1x1",
                "+channel", "-channel", "Meta0", "-separate", "+channel", "-crop", "3x1+1+1", "+repage", "-depth", String(depth), "-endian", "MSB", "gray:/out"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
