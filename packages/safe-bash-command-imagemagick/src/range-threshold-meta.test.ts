import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
const input = ["xc:#505050", "-duplicate", "3", "xc:#808080"];
const cases = [
    { name: "selected Meta0", channels: ["-channel", "Meta0"], expected: "ff" },
    { name: "default synchronizes Meta0", channels: [], expected: "b6" },
    { name: "explicit Default synchronizes Meta0", channels: ["-channel", "Default"], expected: "b6" },
    { name: "Meta0 preserves red", channels: ["-channel", "Meta0"], output: "R", expected: "50" },
    { name: "red preserves Meta0", channels: ["-channel", "R"], expected: "80" },
    { name: "default synchronizes red", channels: [], output: "R", expected: "b6" },
    { name: "Meta1 preserves Meta0", channels: ["-channel", "Meta1"], extra: ["xc:#808080"], expected: "80" },
    { name: "selected Meta1", channels: ["-channel", "Meta1"], extra: ["xc:#808080"], output: "Meta1", expected: "ff" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const threshold of ["10,40,60,90%", "6553.5,26214,39321,58981.5", "%[fx:10],40,60,90%"] as const)
    it.each(cases)(`${mode} ${threshold}: range-threshold $name`, async ({ channels, expected, extra = [], output = "Meta0" }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [...input, ...extra, ...(output ? ["-combine"] : []), ...channels, "-range-threshold", threshold, "+channel",
            ...(output ? ["-channel", output, "-separate", "+channel"] : []), "-depth", "8", "-endian", "MSB", "gray:out"];
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
