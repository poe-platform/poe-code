import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const depth of [8, 16])
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"], ["-composite"]])
it.each([
    { compose: "CopyRed", hex: "306030ff", hex16: "304560603030ffff" },
    { compose: "CopyCyan", hex: "306030ff", hex16: "304560603030ffff" },
    { compose: "CopyGreen", hex: "207030ff", hex16: "202070893030ffff" },
    { compose: "CopyMagenta", hex: "207030ff", hex16: "202070893030ffff" },
    { compose: "CopyBlue", hex: "2060b0ff", hex16: "20206060b0abffff" },
    { compose: "CopyYellow", hex: "2060b0ff", hex16: "20206060b0abffff" },
    { compose: "CopyAlpha", hex: "20603080", hex16: "20206060303080cd" },
    { compose: "CopyOpacity", hex: "20603080", hex16: "20206060303080cd" }
])(`${mode} ${operation.join(" ")} honors $compose at depth ${depth}`, async ({ compose, hex, hex16 }) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const argv = [...(operation[0] === "-composite" ? ["xc:#206030"] : []), depth === 16 ? "xc:#30457089b0ab80cd" : "xc:#3070b080",
        "-background", "#206030", "-compose", compose, ...operation, "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(depth === 16 ? hex16 : hex);
});
