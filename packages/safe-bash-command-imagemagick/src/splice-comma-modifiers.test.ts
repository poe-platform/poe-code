import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for the PPM below.
const cases = [
    { suffixes: [",50%", "%"], metadata: "6x5 4x3+1+1", bytes: 90, hash: "e052dff9e1c94aaa49556f86fad55029a4875839fda57f5005f4c4403876b256" },
    { suffixes: [",5:2", ":2"], metadata: "11x10 7x6+2+2", bytes: 330, hash: "886a3fb626139055f3397ff9ef3173d8b870a880e3dd908c432920dba47abfa9" },
    { suffixes: [",2/3", "/3"], metadata: "10x8 7x5+2+2", bytes: 240, hash: "02fa31429afb5dbb6409b99963a1a86d1f4f3aec74eef0882b75132c71ad9273" },
    { suffixes: [",3", ""], metadata: "7x6 5x4+1+1", bytes: 126, hash: "340aea4368e2657260922a2e587ec5bf85d1d458f6f10695ed29b1dc78578299" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const { suffixes, metadata, bytes, hash } of cases) {
        for (const output of ["info", "rgb"]) {
            it.each(suffixes)(`honors splice comma modifiers %s for ${output} (${mode})`, async suffix => {
                const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...Array.from({ length: 90 }, (_, i) => i)]);
                const files = new Map([["/in.ppm", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/in.ppm", input);
                const argv = ["/in.ppm", "-background", "red", "-repage", "4x3+1+1", "-gravity", "Center", "-splice", `1x1+1+1${suffix}`,
                    ...(output === "info" ? ["-format", "%wx%h %g"] : ["-depth", "8"]), `${output}:/out`];
                const args = createCommandArguments(argv);
                let stdout = "", stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stdout" in result ? result.stdout : stdout).toBe("");
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const resultBytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
                if (output === "info") expect(new TextDecoder().decode(resultBytes)).toBe(metadata);
                else {
                    expect(resultBytes.length).toBe(bytes);
                    expect(createHash("sha256").update(resultBytes).digest("hex")).toBe(hash);
                }
            });
        }
    }
}
