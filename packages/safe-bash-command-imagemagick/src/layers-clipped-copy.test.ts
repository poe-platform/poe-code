import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: clipped Copy premultiplies RGB, unlike Src.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const input of ["xc", "rgba8"] as const)
for (const vertical of [false, true])
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "mosaic"]])
it.each([
    { page: "3x1-1+0", compose: "Copy", expected: "2040408160c1808000000000000000000000000000000000" },
    { page: "3x1+0+0", compose: "Copy", expected: "40408080c0c0808040408080c0c080800000000000000000" },
    { page: "3x1-1+0", compose: "Src", expected: "40408080c0c0808000000000000000000000000000000000" },
    { page: "3x1+2+0", compose: "Copy", expected: operation.includes("mosaic") || operation.includes("-mosaic")
        ? "0000000000000000000000000000000040408080c0c0808040408080c0c08080"
        : "000000000000000000000000000000002040408160c18080" },
    { page: "3x1+2+0", compose: "Src", expected: operation.includes("mosaic") || operation.includes("-mosaic")
        ? "0000000000000000000000000000000040408080c0c0808040408080c0c08080"
        : "0000000000000000000000000000000040408080c0c08080" },
])(`${mode} ${input} ${vertical ? "vertical" : "horizontal"} ${operation.join(" ")}: $compose at $page`, async ({ page, compose, expected }) => {
    if (vertical) page = page.replace("3x1", "1x3").replace("-1+0", "+0-1").replace("+2+0", "+0+2");
    const argv = ["-background", "none", "(", "-size", vertical ? "1x2" : "2x1",
        ...(input === "xc" ? ["xc:#4080c080"] : ["-depth", "8", "rgba:/source"]), "-repage", page, ")",
        "-compose", compose, ...operation, "-depth", "16", "-endian", "MSB", "rgba:/out"];
    const source = Uint8Array.of(64, 128, 192, 128, 64, 128, 192, 128);
    const fs = new MemoryFileSystem(), files = new Map([["/source", source]]);
    await fs.writeFile("/source", source);
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
