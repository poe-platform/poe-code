import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "map", "sync", "filesystem"] as const)
for (const count of ["0", "1"])
for (const list of ["empty", "empty group", "single"] as const)
it(`requires an image at morph (${mode}, count=${count}, ${list})`, async () => {
    const input = new TextEncoder().encode("P3\n2 1\n255\n13 30 79 235 153 61\n");
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["/a.ppm", input], ["/out", original]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const operation = ["-morph", count];
    const args = [...(list === "empty" ? [...operation, "/a.ppm"] : list === "empty group" ? ["/a.ppm", "(", ...operation, ")"] : ["/a.ppm", ...operation]), "-endian", "MSB", "-depth", "8", "rgb:/out"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(new TextDecoder().decode(chunk)); } },
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(list === "single" ? 0 : 1);
    if (list !== "single") expect(mode === "command" ? stderr.join("") : ("stderr" in result ? result.stderr : "")).toContain("no images found for operation '-morph'");
    const output = mode === "map" || mode === "sync" ? files.get("/out") : await fs.readFile("/out");
    expect(output).toEqual(list === "single" ? Uint8Array.of(13, 30, 79, 235, 153, 61) : original);
});
