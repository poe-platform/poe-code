import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGB8 output from the same opaque PPM.
for (const execution of ["command", "retained", "buffered", "sync"] as const)
for (const fixture of [
    { operators: ["-kuwahara", "1x1"], hex: "476c7eb45465b45465698e8086976a847667" },
    { operators: ["-alpha", "off", "-kuwahara", "1x1"], hex: "476c7eb45465b45465698e8086976a847667" },
    { operators: ["-alpha", "associate", "-kuwahara", "1x1"], hex: "00".repeat(18) },
    { operators: ["-alpha", "disassociate", "-kuwahara", "1x1"], hex: "ff".repeat(18) },
    { operators: ["-alpha", "deactivate", "-kuwahara", "1x1"], hex: "476c7eb45465b45465698e8086976a847667" },
    { operators: ["-alpha", "discrete", "-kuwahara", "1x1"], hex: "476c7eb45465b45465698e8086976a847667" },
    { operators: ["-alpha", "associate"], hex: "13385d82a7ccf1163b6085aacff4193e6388" },
    { operators: ["-alpha", "off"], hex: "13385d82a7ccf1163b6085aacff4193e6388" },
]) it(`Kuwahara alpha state ${fixture.operators.join(" ")} (${execution})`, async () => {
    const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i * 37 + 19) % 256))]);
    const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", ...fixture.operators, "-depth", "8", `rgb:${execution === "command" ? "-" : "/out.rgb"}`];
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = execution === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : execution === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const actual = execution === "command" ? stdout
        : Buffer.from(execution === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!).toString("hex");
    expect(actual).toBe(fixture.hex);
});
