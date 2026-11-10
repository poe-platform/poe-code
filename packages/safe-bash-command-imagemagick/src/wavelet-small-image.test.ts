import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand } from "./index.js";

it.each([
    ["0%", "0b30557a9fc4e90e33587da2c7ec11365b80a5caef14395e83a8cdf2173c6186abd0f51a3f6489aed3f81d4267"],
    ["9%", "2449617693abd4274b647996aed32a42678c8cb1d620456a7d8fb4d923486d929ebcdc3358708fa1c2df295b73"]
])("matches native wavelet denoising of a 5×3 RGB image at %s", async (threshold, expected) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/pic.ppm", Buffer.concat([
        Buffer.from("P6\n5 3\n255\n"),
        Buffer.from(Array.from({ length: 45 }, (_, i) => (11 + i * 37) % 256))
    ]));
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: ["pic.ppm", "-wavelet-denoise", threshold, "-depth", "8", "rgb:out.rgb"],
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    // ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGB bytes.
    expect(Buffer.from(await fs.readFile("/out.rgb")).toString("hex")).toBe(expected);
});
