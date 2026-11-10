import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Raw RGB stdout from native ImageMagick 7.1.2-35 Q16-HDRI.
it.each([
    { geometry: "+1+1x1", expected: "d2e1f08291a0aab9c85a69780a1928324150" },
    { geometry: "+1+1x", expected: "d2e1f08291a0aab9c85a69780a1928324150" },
    { geometry: "+1+1X2", expected: "d2e1f08291a0aab9c85a69780a1928324150" },
    { geometry: "3x2+1+1x2", expected: "d2e1f08291a0aab9c85a69780a1928324150" },
    { geometry: "+1+1", expected: "d2e1f08291a0aab9c85a69780a1928324150" },
    { geometry: "+1+2+3", expected: "5a69780a1928324150d2e1f08291a0aab9c8" },
    { geometry: "+1,2", expected: "5a69780a1928324150d2e1f08291a0aab9c8" },
    { geometry: "+0+0", expected: "0a19283241505a69788291a0aab9c8d2e1f0" },
])("preserves native roll stdout for $geometry", async ({ geometry, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", new TextEncoder().encode("P3\n3 2\n255\n10 25 40 50 65 80 90 105 120\n130 145 160 170 185 200 210 225 240\n"));
    const args = createCommandArguments(["in.ppm", "-roll", geometry, "-depth", "8", "rgb:-"]);
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
});
