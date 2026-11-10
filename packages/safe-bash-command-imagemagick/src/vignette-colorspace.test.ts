import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
const cases = [
    { space: "Lab", vignette: true, hash: "6b71c7520118e08629fa608caeb7ee7404cc9b89a2f87e256b8c4c847ed5f3f0" },
    { space: "HSL", vignette: true, hash: "540c88aeb8c2c20b581962ee8065628a7a0f6643ba1647dab359c1b54a1484ff" },
    { space: "Lab", vignette: false, hash: "ed1819e3d46a9282d0b51adca94aec8e73bcba1ddd5b432259bc918c0c035db0" },
    { space: "HSL", vignette: false, hash: "ed1819e3d46a9282d0b51adca94aec8e73bcba1ddd5b432259bc918c0c035db0" },
    { space: "sRGB", vignette: true, hash: "27e57b059415ca01478c819165f90ede7cd67ede4c99864c7ce1ca266a08a58b" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`retains native $space pixels after vignette=$vignette (${mode})`, async ({ space, vignette, hash }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["-size", "6x4", "xc:#3876b4", "-colorspace", space, "-background", "#d29153",
            ...(vignette ? ["-vignette", "0x0+1+1"] : []), "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(6 * 4 * 4);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
