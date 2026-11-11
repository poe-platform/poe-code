import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(["2x1", "%[fx:n]x1", "%[fx:u[1].w/3]x1"])(`expands sharpen radius against the image list (${mode}): %s`, async geometry => {
    const input = new Uint8Array([...new TextEncoder().encode("P6\n6 4\n255\n"), ...Array.from({ length: 72 }, (_, i) => i)]);
    const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", "+clone", "-sharpen", geometry, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
    const argumentValues = createCommandArguments(argv);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, String("stderr" in result ? result.stderr : stderr)).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    // ImageMagick 7.1.2-35 Q16-HDRI: both expressions resolve to the literal radius 2.
    expect(bytes.length).toBe(144);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("24f54693ce50b5e75dfeb7f9c8518694474aa05a9b1ec0bbd1b1598731d7965c");
});
