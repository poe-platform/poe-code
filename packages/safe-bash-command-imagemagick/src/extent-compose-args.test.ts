import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 outputs including unchanged padding.
const cases = [
    { compose: "Blend", weighted: "4b6d54764b6d547630805080", defaults: "645b57f0645b57f030805080" },
    { compose: "Dissolve", weighted: "4d6b546c4d6b546c30805080", defaults: "744f5ab8744f5ab830805080" },
];

describe.each(["command", "sync", "buffered", "retained"] as const)("extent compose arguments (%s)", mode => {
    for (const { compose, weighted, defaults } of cases) {
        it.each([
            { name: "image artifact", options: ["-set", "artifact:compose:args", "25,70"], expected: weighted },
            { name: "command define", options: ["-define", "compose:args=25,70"], expected: weighted },
            { name: "default arguments", options: [], expected: defaults },
            { name: "artifact before define", options: ["-set", "artifact:compose:args", "25,70", "-define", "compose:args=100,100"], expected: weighted },
            { name: "artifact after define", options: ["-define", "compose:args=100,100", "-set", "artifact:compose:args", "25,70"], expected: weighted },
            { name: "cleared artifact", options: ["-set", "artifact:compose:args", "25,70", "+set", "artifact:compose:args"], expected: defaults },
            { name: "separate image artifacts", options: ["-set", "artifact:compose:args", "25,70", "xc:#a0306070"], expected: weighted + defaults },
        ])(`${compose}: $name`, async ({ options, expected }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const argv = ["-size", "2x1", "xc:#a0306070", "-background", "#30805080", "-compose", compose,
                ...options, "-extent", "3x1", "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
});
