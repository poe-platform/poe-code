import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, exported as RGBA8.
const blends = [
    { compose: "Multiply", expected: "134529ff" },
    { compose: "Screen", expected: "358378ff" },
    { compose: "Darken", expected: "286848ff" },
    { compose: "Lighten", expected: "286870ff" },
    { compose: "HardLight", expected: "165a58ff" },
    { compose: "ColorDodge", expected: "248666ff" },
    { compose: "Exclusion", expected: "326e67ff" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"], ["-composite"]])
it.each([
    ...blends.map(blend => ({ ...blend, foreground: "#3070b080" })),
    { compose: "Multiply", foreground: "#3070b0ff", expected: "062a21ff" },
])(`${mode} ${operation.join(" ")} $compose with $foreground matches native`, async ({ compose, foreground, expected }) => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const args = createCommandArguments([
        ...(operation[0] === "-composite" ? ["xc:#206030"] : []), `xc:${foreground}`,
        "-background", "#206030", "-compose", compose, ...operation, "-depth", "8", "rgba:/out",
    ]);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args.args, files)
        : await runMagickCli(args.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
