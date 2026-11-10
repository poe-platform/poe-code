import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 output from RGBA8 colors.
const cases = [
    { colors: ["#3070b080"], compose: "Over", hex: "286870ff" },
    { colors: ["#3070b080", "#c0204080"], compose: "Over", hex: "744458ff" },
    { colors: ["#3070b080", "#c0204080", "#c0402060"], compose: "Over", hex: "914243ff" },
    { colors: ["#3070b080", "#c0204080"], compose: "Src", hex: "c0204080" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"]])
it.each(cases)(`${mode} ${operation.join(" ")}: $compose $colors retains intermediate precision`, async ({ colors, compose, hex }) => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const argv = [...colors.map(color => `xc:${color}`), "-background", "#206030", "-compose", compose,
        ...operation, "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it(`${mode}: flatten preserves precision across storage spans and clipped page offsets`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["-size", "1025x2", "xc:#3070b080",
        "(", "xc:#c0204080", "-repage", "1025x2-1+1", ")",
        "(", "xc:#c0402060", "-repage", "1025x2-1+1", ")",
        "-background", "#206030", "-compose", "Over", "-flatten", "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe("286870ff".repeat(1025) + "914243ff".repeat(1024) + "286870ff");
});
