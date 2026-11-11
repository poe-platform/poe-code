import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const splice = ["-background", "#8ac46270", "-splice", "1x0+0+0"];

// ImageMagick 7.1.2-35 Q16-HDRI keeps Copy's unblended alpha through Off.
for (const backend of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "306080", modes: ["copy", "off"], after: [], depth: 8, expected: "306080ff" },
        { color: "306080", modes: ["copy", "off", "on"], after: [], depth: 8, expected: "306080ff" },
        { color: "306080", modes: ["copy", "off", "activate"], after: [], depth: 8, expected: "30608058" },
        { color: "806030", modes: ["copy", "off", "activate"], after: [], depth: 8, expected: "80603063" },
        { color: "306080", modes: ["copy", "off"], after: splice, depth: 8, expected: "8ac4627030608058" },
        { color: "806030", modes: ["copy", "off"], after: splice, depth: 8, expected: "8ac4627080603063" },
        { color: "306080", modes: ["off"], after: splice, depth: 8, expected: "8ac46270306080ff" },
        { color: "306080", modes: ["off", "activate"], after: [], depth: 8, expected: "30608000" },
        { color: "306080", modes: ["copy", "off", "off", "activate"], after: [], depth: 8, expected: "30608058" },
        { color: "306080", modes: ["copy", "off", "deactivate", "activate"], after: [], depth: 8, expected: "306080ff" },
        { color: "306080", modes: ["copy", "off", "activate"], after: [], depth: 16, expected: "3030606080805872" },
        { color: "806030", modes: ["copy", "off"], after: splice, depth: 16, expected: "8a8ac4c46262707080806060303063ba" },
    ])(`${backend}: $color $modes $after at depth $depth`, async ({ color, modes, after, depth, expected }) => {
        const argv = [`xc:#${color}`, ...modes.flatMap(mode => ["-alpha", mode]), ...after,
            "-depth", String(depth), "-endian", "MSB", backend === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, backend === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = backend === "command" ? Buffer.concat(chunks)
            : backend === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
