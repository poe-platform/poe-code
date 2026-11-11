import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: each RGB byte is its input index.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["1x1.1.1+1+1", "000102030405090a0b0c0d0e0f10111213141516171b1c1d1e1f20212223363738393a3b3f404142434445464748494a4b4c4d515253545556575859"],
        ["1x1+0+0", "000102030405090a0b0c0d0e0f10111213141516171b1c1d1e1f20212223363738393a3b3f404142434445464748494a4b4c4d515253545556575859"],
        ["1x1+1+1.5.5", "0001020304050607080c0d0e0f101112131415161718191a1e1f202122232425262728292a2b2c30313233343548494a4b4c4d4e4f50545556575859"],
        ["1x1+1+1.5", "0001020304050607080c0d0e0f101112131415161718191a1e1f202122232425262728292a2b2c30313233343548494a4b4c4d4e4f50545556575859"],
    ])(`retains parsed chop fields before a second decimal in %s (${mode})`, async (geometry, expected) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...Uint8Array.from({ length: 90 }, (_, i) => i)]);
        const files = new Map([["in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["in.ppm", "-repage", "4x3+1+1", "-gravity", "Center", "-chop", geometry,
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
        expect("stdout" in result ? result.stdout : stdout).toBe("5x4 3x2+1+1");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
