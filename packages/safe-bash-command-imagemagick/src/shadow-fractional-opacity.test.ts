import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, starting with ordinary RGBA8 PAM pixels.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { opacity: 37, multiply: true, depth: 8, pixel: "00000091" },
        { opacity: 37, multiply: false, depth: 16, pixel: "00000000000030a9" },
        { opacity: 37, multiply: false, depth: 8, pixel: "00000030" },
        { opacity: 100, multiply: false, depth: 16, pixel: "0000000000008383" },
    ])(`retains fractional shadow opacity $opacity, multiply=$multiply, depth=$depth (${mode})`, async ({ opacity, multiply, depth, pixel }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            19, 56, 93, 131,
        ]);
        const files = new Map([["/in.pam", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", input);
        const args = ["/in.pam", "-background", "black", "-shadow", `${opacity}x0+0+0`,
            ...(multiply ? ["-channel", "A", "-evaluate", "multiply", "3", "+channel"] : []),
            "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixel);
    });
}
