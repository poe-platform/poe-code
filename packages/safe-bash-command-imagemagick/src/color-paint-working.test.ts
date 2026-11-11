import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const space of ["CMYK", "Lab", "DisplayP3"])
for (const method of ["point", "replace", "floodfill", "reset", ...(space === "CMYK" ? ["option"] : [])])
for (const output of ["working", "rgb"])
for (const width of [1, ...(method === "point" ? [2] : [])])
it(`${mode}: ${space} ${method} (${width} pixels) updates ${output} samples`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const cmyk = space === "CMYK";
    const argv = ["-size", `${width}x1`, cmyk ? "xc:red" : "xc:#34a05c", "-colorspace", space, "-fill", cmyk ? "#0000ff80" : "#cf468380",
        ...(method === "option" ? ["-floodfill", "+0+0", "cmyk(0%,100%,100%,0%)"] : ["-draw", `color ${width - 1},0 ${method}`]),
        ...(output === "rgb" ? ["-colorspace", "sRGB"] : cmyk ? [] : ["-channel", "R", "-separate"]),
        "-depth", "8", output === "rgb" ? "rgba:-" : cmyk ? "cmyka:-" : "gray:-"];
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    const painted = output === "working" ? cmyk ? [0, 0, 255, 0, 128] : [207]
        : cmyk ? [255, 255, 0, 128] : space === "Lab" ? [0, 234, 200, 128] : [225, 55, 132, 128];
    const original = output === "working" ? cmyk ? [0, 255, 255, 0, 255] : [space === "Lab" ? 150 : 85]
        : cmyk ? [255, 0, 0, 255] : [52, 160, 92, 255];
    expect([...bytes]).toEqual(width === 1 ? painted : [...original, ...painted]);
});
