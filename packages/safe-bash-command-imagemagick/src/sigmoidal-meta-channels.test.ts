import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, big-endian 16-bit gray samples.
const inputPlanes = ["-size", "3x1", "xc:#505050", "-duplicate", "3", "(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
const cases = [
    { name: "selected Meta0", operations: ["-combine", "-channel", "Meta0", "-sigmoidal-contrast", "4x50%", "+channel", "-channel", "Meta0", "-separate"], expected: "329780a8ce71" },
    { name: "inverse Meta0", operations: ["-combine", "-channel", "Meta0", "+sigmoidal-contrast", "4x50%", "+channel", "-channel", "Meta0", "-separate"], expected: "4ce58061b3ff" },
    { name: "default channels", operations: ["-combine", "-sigmoidal-contrast", "4x50%", "+channel", "-channel", "Meta0", "-separate"], expected: "329780a8ce71" },
    ...["Default", "All"].map(channel => ({ name: `${channel} channels`, operations: ["-combine", "-channel", channel, "-sigmoidal-contrast", "4x50%", "+channel", "-channel", "Meta0", "-separate"], expected: channel === "All" ? "40408080c0c0" : "329780a8ce71" })),
    { name: "absolute midpoint", operations: ["-combine", "-channel", "Meta0", "-sigmoidal-contrast", "4x32767.5", "+channel", "-channel", "Meta0", "-separate"], expected: "329780a8ce71" },
    { name: "selected Meta1", operations: ["-size", "3x1", "xc:#a0a0a0", "-combine", "-channel", "Meta1", "-sigmoidal-contrast", "4x50%", "+channel", "-channel", "Meta1", "-separate"], expected: "a9efa9efa9ef" },
    { name: "RGB selection preserves Meta0", operations: ["-combine", "-channel", "R", "-sigmoidal-contrast", "4x50%", "+channel", "-channel", "Meta0", "-separate"], expected: "40408080c0c0" },
    { name: "Meta1 selection preserves Meta0", operations: ["-size", "3x1", "xc:#a0a0a0", "-combine", "-channel", "Meta1", "-sigmoidal-contrast", "4x50%", "+channel", "-channel", "Meta0", "-separate"], expected: "40408080c0c0" },
];

for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: adjusts extra channels for $name`, async ({ operations, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = [...inputPlanes, ...operations, "-endian", "MSB", "-depth", "16", "gray:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const command = mode === "magick" || mode === "convert";
        const result = command ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = command || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
