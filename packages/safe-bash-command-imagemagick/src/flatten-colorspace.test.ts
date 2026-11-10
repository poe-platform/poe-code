import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI; backgrounds blend in the working colorspace.
const spaces = [
    { space: "CMYK", gamma: "0.454545", hex: "89b0d7ff" },
    { space: "HSL", gamma: "0.454545", hex: "d37ff0ff" },
    { space: "RGB", gamma: "1", hex: "bec8dcff" },
    { space: "sRGB", gamma: "0.454545", hex: "97b7d7ff" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"], []])
for (const output of ["info", "rgba"] as const)
it.each(spaces)(`${mode} ${operation.join(" ") || "round trip"} ${output}: $space`, async ({ space, gamma, hex }) => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const argv = ["xc:#3070b080", "-colorspace", space, ...operation,
        ...(output === "info" ? ["-format", "%[colorspace] %x %y %U %[gamma] <%l> <%[custom:key]>", "info:/out"]
            : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex"))
        .toBe(output === "info" ? `${space} 72 72 Undefined ${gamma} <> <>` : operation.length ? hex : "3070b080");
});
