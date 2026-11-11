import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, with input RGB bytes 0 through 89.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["1x1.1.1+1+1", "e25aab5db1ed9088a33450e21d832454c4fbb69f553e4b2aaf4eab7999984d7a", "7x6 5x4+1+1", 126],
        ["1x1..1+1+1", "e25aab5db1ed9088a33450e21d832454c4fbb69f553e4b2aaf4eab7999984d7a", "7x6 5x4+1+1", 126],
        ["1x1+0+0", "e25aab5db1ed9088a33450e21d832454c4fbb69f553e4b2aaf4eab7999984d7a", "7x6 5x4+1+1", 126],
        ["1x1+1+1.5.5", "340aea4368e2657260922a2e587ec5bf85d1d458f6f10695ed29b1dc78578299", "7x6 5x4+1+1", 126],
        ["1x1+1+1..5", "340aea4368e2657260922a2e587ec5bf85d1d458f6f10695ed29b1dc78578299", "7x6 5x4+1+1", 126],
        ["1x1+1+1.5", "340aea4368e2657260922a2e587ec5bf85d1d458f6f10695ed29b1dc78578299", "7x6 5x4+1+1", 126],
        ["1x1+1.5.5+1", "35dda342544e40c0857415954bfe821969feb6d50f5c297851624aca226cfa7d", "7x6 5x4+1+1", 126],
        ["1x1+1..5+1", "35dda342544e40c0857415954bfe821969feb6d50f5c297851624aca226cfa7d", "7x6 5x4+1+1", 126],
        ["1x1+1.5+0", "35dda342544e40c0857415954bfe821969feb6d50f5c297851624aca226cfa7d", "7x6 5x4+1+1", 126],
        ["1x1.1.1+1+1%", "e052dff9e1c94aaa49556f86fad55029a4875839fda57f5005f4c4403876b256", "6x5 4x3+1+1", 90],
        ["1x1.1.1+1+1/2", "02fa31429afb5dbb6409b99963a1a86d1f4f3aec74eef0882b75132c71ad9273", "10x8 7x5+2+2", 240],
    ])(`retains parsed splice fields before a second decimal in %s (${mode})`, async (geometry, expected, info, length) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...Uint8Array.from({ length: 90 }, (_, i) => i)]);
        const files = new Map([["in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["in.ppm", "-background", "red", "-repage", "4x3+1+1", "-gravity", "Center", "-splice", geometry,
            "-depth", "8", "-write", "rgb:out", "-format", "%wx%h %g", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(info);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(output).toHaveLength(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
