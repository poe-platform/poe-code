import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick preserves RGB when toggling alpha, regardless of selection.
for (const backend of ["command", "retained", "buffered", "sync"] as const)
for (const selection of ["none", "region", "write-mask"] as const)
for (const mode of ["On", "Set", "Activate", "Deactivate", "Discrete", "Off"])
for (const alpha of ["60", "ff"])
it(`${backend}: alpha ${mode} preserves RGB under ${selection}, alpha=${alpha}`, async () => {
    const files = new Map<string, Uint8Array>([
        ["/mask.pgm", Buffer.concat([Buffer.from("P5\n3 1\n255\n"), Buffer.from([0, 255, 255])])],
        ["/out", Buffer.from("KEEP")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const argv = ["-size", "3x1", `xc:#804020${alpha}`,
        ...(selection === "none" ? [] : [`-${selection}`, selection === "region" ? "1x1+1+0" : "/mask.pgm"]),
        "-alpha", mode, ...(selection === "none" ? [] : [`+${selection}`]), "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = backend === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : backend === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, backend === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = backend === "command" || backend === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    const expectedAlpha = ["Deactivate", "Discrete", "Off"].includes(mode) ? "ff" : alpha;
    expect(Buffer.from(output).toString("hex")).toBe(`804020${expectedAlpha}`.repeat(3));
});
