import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff804020c0ffee231337", "hex")]);
// ImageMagick 7.1.2-35 Q16-HDRI: -repage 9x8+4+3 -filter point
// -interpolate METHOD -rotate ANGLE -depth 8 rgb:out.
const rotations = [
    { angle: "0", geometry: "3x2|9x8+4+3", hash: "fc35c8ea9185bd80585769387d4ce44a22e60454cd966496756f04e81c45a6ad" },
    { angle: "90", geometry: "2x3|8x9+3+4", hash: "03da3d3a095c728acc6a38c671ea5da08fc44f053f85534a684681269c8c7a33" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const interpolation of ["mesh", "blend", "catrom", "spline", "bilinear"]) {
        it.each(rotations)(`${mode}: preserves lossless pixels and page with ${interpolation} at $angle degrees`, async ({ angle, geometry, hash }) => {
            const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
            const args = ["/in.ppm", "-repage", "9x8+4+3", "-filter", "point", "-interpolate", interpolation,
                "-rotate", angle, "-depth", "8", "-write", "rgb:/out", "-format", "%wx%h|%g", "info:"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result, stderr).toMatchObject({ exitCode: 0 });
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe(geometry);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        });
    }
}
