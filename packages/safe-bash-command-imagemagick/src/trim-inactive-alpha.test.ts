import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps all four red pixels and the source page.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const alphaOff of [true, false])
for (const operation of ["trim", "percent", "bounds"] as const)
for (const working of [false, true])
for (const format of operation === "bounds" ? ["info"] as const : ["info", "rgba"] as const)
it(`${mode} ${format}: ${operation} keeps the foreground with alpha off=${alphaOff}, working=${working}`, async () => {
    const keep = new TextEncoder().encode("KEEP");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const files = new Map([["/out", keep]]);
    const argv = ["-size", "6x5", "xc:white", "-fill", "red", "-draw", "rectangle 2,1 3,2",
        ...(alphaOff ? ["-alpha", "off"] : []), ...(working ? ["-evaluate", "divide", "1"] : []),
        ...(operation === "bounds" ? [] : operation === "percent" ? ["-define", "trim:percent-background=50%", "-trim"] : ["-trim"]),
        "-depth", "8", "-format", operation === "bounds" ? "%@ %[bounding-box]" : "%wx%h %g;", `${format}:/out`];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(format === "info" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex"))
        .toBe(format === "info" ? (operation === "bounds" ? "2x2+2+1 2,1 4,3" : "2x2 6x5+2+1;") : "ff0000ffff0000ffff0000ffff0000ff");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
});
