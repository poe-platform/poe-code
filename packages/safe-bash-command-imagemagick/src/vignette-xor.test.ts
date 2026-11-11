import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ["Xor", "#3169af80", "#b4502060", "42201163", "ef2c662cf7b55541185bc35559539e8a934a260a215274e90d82f1eb416bd5e0"],
    ["Over", "#3169af80", "#b4502060", "a4533268", "8afa5d6cceff8ef337955287c79b91c44bc9557c40fd782c7b8559265091b121"],
    ["Xor", "#3169af80", "#b45020", "ab4c1ef2", "1fbc4043470b8a9a8cf0db562d93c9a1881009520a75f2da873ac09322b99e63"],
    ["Xor", "#3169af80", "#b4502000", "0205090d", "16f1113c472a8f4ad0bd1df1294506de56cd7947a32effd05902fb9f823dae29"],
    ["Xor", "#3169af00", "#b4502060", "42201163", "ef2c662cf7b55541185bc35559539e8a934a260a215274e90d82f1eb416bd5e0"],
    ["Xor", "#3169af", "#b4502060", "42201163", "ef2c662cf7b55541185bc35559539e8a934a260a215274e90d82f1eb416bd5e0"]
])(`matches native vignette %s for %s on %s (${backend})`, async (compose, source, background, corner, hash) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const argv = ["-size", "7x5", `xc:${source}`, "-background", background, "-compose", compose,
        "-vignette", "0x1+1+1", "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = backend === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : backend === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, backend === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(output).toHaveLength(7 * 5 * 4);
    expect(Buffer.from(output.slice(0, 4)).toString("hex")).toBe(corner);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
