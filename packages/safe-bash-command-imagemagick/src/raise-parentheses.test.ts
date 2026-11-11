import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const option of ["-raise", "+raise"])
it.each(["2x1", "(2x1)", "%[option:bevel]", "(%[fx:w/4]x1)"])(`matches native ${option} %s with parenthesized dimensions, ${mode}`, async geometry => {
    const fs = new MemoryFileSystem();
    const args = ["-size", "8x7", "xc:#385060", "-set", "option:bevel", "(2x1)", option, geometry, "-depth", "8", "rgb:-"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(output).toHaveLength(168);
    // Native ImageMagick 7.1.2-35 Q16-HDRI, complete 8x7 RGB8 frame.
    expect(createHash("sha256").update(output).digest("hex")).toBe(option === "-raise"
        ? "8d17c8013c42d1557981c9adc1a8e87781cb4192e83c21b6297c8fd13718942a"
        : "189f1783601fc713a1ee6039bc8da6d3eba7ca20bba86b13dd24f9fc9d719315");
});
