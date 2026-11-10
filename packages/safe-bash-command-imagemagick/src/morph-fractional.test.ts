import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including the unchanged endpoint and 8-bit controls.
for (const mode of ["map", "sync", "filesystem", "command"])
for (const { depth, remove, expected } of [
    { depth: "16", remove: "0,2", expected: "20a133b45555af2f919178f9" },
    { depth: "8", remove: "0,2", expected: "213455af9179" },
    { depth: "16", remove: "1,2", expected: "0d0d1e1e4f4febeb99993d3d" }
])
it(`preserves fractional morph samples (${mode}, depth=${depth}, delete=${remove})`, async () => {
    const files = new Map([
        ["/a.ppm", Buffer.from("P3\n2 1\n255\n13 30 79 235 153 61\n")],
        ["/b.ppm", Buffer.from("P3\n2 1\n255\n52 73 91 114 137 180\n")],
        ["/out", Buffer.from("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/a.ppm", "/b.ppm", "-morph", "1", "-delete", remove, "-endian", "MSB", "-depth", depth, "rgb:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
