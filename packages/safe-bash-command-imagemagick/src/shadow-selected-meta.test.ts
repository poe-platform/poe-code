import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: the shadow border only copies selected meta channels.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    for (const sample of [0xc0, 0x30]) it.each([
        { selection: ["-channel", "R"], shadow: true, preserved: false },
        { selection: ["-channel", "A"], shadow: true, preserved: false },
        { selection: ["-channel", "All"], shadow: true, preserved: false },
        { selection: ["-channel", "Meta0"], shadow: true, preserved: true },
        { selection: ["-channel", "R,Meta0"], shadow: true, preserved: true },
        { selection: [], shadow: true, preserved: true },
        { selection: ["-channel", "Default"], shadow: true, preserved: true },
        { selection: ["-channel", "R", "+channel"], shadow: true, preserved: true },
        { selection: ["-channel", "R"], shadow: false, preserved: true },
    ])(`honors $selection for Meta0 with shadow=$shadow (${backend}, sample=${sample})`, async ({ selection, shadow, preserved }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:#404040", "-duplicate", "3", `xc:#${sample.toString(16).repeat(3)}`,
            "-combine", ...selection, ...(shadow ? ["-shadow", "60x1+2+1"] : []), "+channel",
            "-channel", "Meta0", "-separate", "+channel", "-depth", "8", "-write", "gray:/out",
            "-format", "%wx%h", "info:/dimensions"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        expect("stderr" in result ? String(result.stderr) : stderr).toBe("");
        const stored = backend === "retained" || backend === "command";
        const data = stored ? await filesystem.readFile("/out") : files.get("/out")!;
        const dimensions = stored ? await filesystem.readFile("/dimensions") : files.get("/dimensions")!;
        expect(new TextDecoder().decode(dimensions)).toBe(shadow ? "7x6" : "3x2");
        const expected = shadow ? new Uint8Array(42) : new Uint8Array(6).fill(sample);
        if (shadow && preserved) {
            expected.fill(sample, 16, 19);
            expected.fill(sample, 23, 26);
        }
        expect(data).toEqual(expected);
    });
}
