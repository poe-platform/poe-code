import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: modifiers between offsets preserve both coordinates.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const output of ["info", "rgb"] as const) {
        it.each(["1x1+1+1", "1x1+1!+1", "1x1+1^+1", "1x1+1#+1"])(
            `chops %s with native pixels and page geometry (${mode}, ${output})`, async geometry => {
                const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...Array.from({ length: 90 }, (_, i) => i)]);
                const files = new Map([["/in.ppm", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/in.ppm", input);
                const argv = ["/in.ppm", "-repage", "4x3+1+1", "-gravity", "Center", "-chop", geometry,
                    ...(output === "info" ? ["-format", "%wx%h %g"] : ["-depth", "8"]), `${output}:/out`];
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
                expect(output === "info" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(output === "info"
                    ? "5x4 3x2+1+1"
                    : "0001020304050607080c0d0e0f101112131415161718191a1e1f202122232425262728292a2b2c30313233343548494a4b4c4d4e4f50545556575859");
                expect("stderr" in result ? result.stderr : stderr).toBe("");
            },
        );
    }
}
