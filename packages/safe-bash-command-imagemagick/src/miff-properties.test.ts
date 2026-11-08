import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
it("writes comment and label properties through the public magick command", async () => {
    const fs = new MemoryFileSystem();
    const result = await createMagickCommand().execute({
        command: "magick", args: ["xc:#123456", "-set", "comment", "side A", "-set", "label", "badge", "out.miff"],
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    const bytes = await fs.readFile("/out.miff");
    expect(new TextDecoder().decode(bytes)).toContain("comment={side A}\nlabel={badge}\n");
    if (nativeMagick) {
        const identified = spawnSync("magick", ["identify", "-format", "|%c|%l", "miff:-"], { input: bytes });
        expect(identified.status).toBe(0);
        expect(identified.stdout.toString()).toBe("|side A|badge");
    }
});
