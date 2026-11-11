import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["-merge", "_merge", "--merge", "-m-o-s-a-i-c", "_coalesce", "merge", "m-erge", "me_rge", "M-o_S-a_I-c"])(`${mode} validates -layers %s`, async method => {
        const bytes = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...Array.from({ length: 18 }, (_, i) => (i + 1) * 10)]);
        const files = new Map([["/in.ppm", bytes]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", bytes);
        const args = ["/in.ppm", "-layers", method, "-format", "%wx%h", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const invalid = method.startsWith("-") || method.startsWith("_");
        expect(result.exitCode).toBe(invalid ? 1 : 0);
        expect("stdout" in result ? result.stdout : stdout).toBe(invalid ? "" : "3x2");
        expect("stderr" in result ? result.stderr : stderr).toBe(invalid ? `magick: unrecognized layer method '-layers' '${method}'\n` : "");
    });
}
