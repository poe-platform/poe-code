import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["public", "retained", "map", "sync"] as const)
for (const destination of ["out.ppm", "rgb:-"])
it.each([[], ["-verbose"], ["-verbose", "+verbose"]])(`final conversion summary (${mode}, ${destination}, %j)`, async (...options: string[]) => {
    const argv = ["xc:red", ...options, destination];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = mode === "public" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    if ("stderr" in result) stderr += result.stderr;
    if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) chunks.push(result.stdoutBytes);
    else if ("stdout" in result && typeof result.stdout === "string") chunks.push(new TextEncoder().encode(result.stdout));
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const stdout = Buffer.concat(chunks);
    const binary = destination === "rgb:-";
    if (binary) expect(stdout.subarray(0, 6).toString("hex")).toBe("ffff00000000");
    else expect((mode === "map" || mode === "sync" ? files.get(destination)! : await fs.readFile(`/${destination}`)).length).toBe(19);
    const summary = stdout.subarray(binary ? 6 : 0).toString();
    if (options.at(-1) === "-verbose") expect(summary).toMatch(new RegExp(`^xc:red=>${binary ? "-" : "out\\.ppm"} XC 1x1 1x1\\+0\\+0 16-bit sRGB${binary ? "" : " 19B"} [0-9.]+u [0-9:.]+\\n$`));
    else expect(summary).toBe("");
});
