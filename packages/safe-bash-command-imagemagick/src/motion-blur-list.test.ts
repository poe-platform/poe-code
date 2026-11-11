import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(["2x1+30", "%[fx:n]x1+30", "%[fx:u[1].w/3]x1+30"])(`evaluates motion-blur geometry against the current list: %s (${mode})`, async geometry => {
    const input = Buffer.concat([Buffer.from("P6\n6 4\n255\n"), Buffer.from(Array.from({ length: 72 }, (_, i) => i))]);
    const files = new Map([["/in.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", "+clone", "-motion-blur", geometry, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
    const args = createCommandArguments(argv);
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, String("stderr" in result ? result.stderr : stderr)).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(chunks) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(output.length).toBe(144);
    // Native ImageMagick 7.1.2-35 Q16-HDRI, including the literal radius control.
    expect(createHash("sha256").update(output).digest("hex")).toBe("ee36242ae9d973ca942380997ddeb139dddaa098fcc867540919a5d372256a3f");
});
