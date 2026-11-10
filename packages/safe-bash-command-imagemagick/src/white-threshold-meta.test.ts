import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const ramp = ["(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
const input = ["-size", "3x1", "xc:#505050", "-duplicate", "3", ...ramp];
// ImageMagick 7.1.2-35 Q16-HDRI: extra channels have a zero cutoff.
const cases = [
    { name: "Meta0 at 50%", channels: ["-channel", "Meta0"], threshold: "50%", expected: "ffffffffffff" },
    { name: "Meta0 at 100%", channels: ["-channel", "Meta0"], threshold: "100%", expected: "ffffffffffff" },
    { name: "default channels", channels: [], threshold: "50%", expected: "ffffffffffff" },
    { name: "Meta1", channels: ["-channel", "Meta1"], threshold: "50%", extra: ["-size", "3x1", "xc:#a0a0a0"], output: "Meta1", expected: "ffffffffffff" },
    { name: "red leaves Meta0 unchanged", channels: ["-channel", "R"], threshold: "50%", expected: "40408080c0c0" },
    { name: "Meta1 leaves Meta0 unchanged", channels: ["-channel", "Meta1"], threshold: "50%", extra: ["-size", "3x1", "xc:#a0a0a0"], expected: "40408080c0c0" },
    { name: "ordinary grayscale", channels: [], threshold: "50%", source: ramp, output: "", expected: "4040ffffffff" },
    { name: "property-expanded threshold", channels: ["-channel", "Meta0"], threshold: "%[fx:50]%", expected: "ffffffffffff" },
    { name: "explicit Default", channels: ["-channel", "Default"], threshold: "100%", expected: "ffffffffffff" },
    { name: "both extra channels", channels: ["-channel", "Meta0,Meta1"], threshold: "100%", extra: ["-size", "3x1", "xc:#a0a0a0"], output: "Meta0,Meta1", expected: "ff".repeat(12) },
    { name: "16-bit smallest positive sample", channels: ["-channel", "Meta0"], threshold: "100%", source: ["xc:black", "-duplicate", "3", "xc:#000100010001"], expected: "ffff" },
    { name: "chunk and row boundaries", channels: ["-channel", "Meta0"], threshold: "100%", source: ["-size", "513x2", "xc:black", "-duplicate", "3", "xc:#808080"], expected: "ffff".repeat(1026) },
    { name: "selected zero stays zero", channels: ["-channel", "Meta0"], threshold: "100%", source: ["xc:#505050", "-duplicate", "3", "xc:black"], expected: "0000" },
    { name: "default uses source intensity", channels: [], threshold: "100%", source: ["xc:black", "-duplicate", "3", "xc:#808080"], expected: "8080" },
    { name: "default whitens zero plane with nonzero intensity", channels: [], threshold: "100%", source: ["xc:#505050", "-duplicate", "3", "xc:black"], expected: "ffff" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: white-threshold $name`, async ({ channels, threshold, expected, source = input, extra = [], output = "Meta0" }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [...source, ...extra, ...(output ? ["-combine"] : []), ...channels, "-white-threshold", threshold, "+channel",
            ...(output ? ["-channel", output, "-separate", "+channel"] : []), "-depth", "16", "-endian", "MSB", "gray:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
