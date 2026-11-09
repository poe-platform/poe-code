import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runCompareCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: identical 3x2 RGB images,
// plus a one-pixel edit and the original 588-byte sRGB profile.
const fixtures = {
    "profile.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAABdmlDQ1BJQ0MgUHJvZmlsZQAAeJx1kT1LA0EQhp8kSkQjFlqIWByikiKCKIilxiJNkBAjGLXJXXKJkIvHXYIEW8HGImAh2vhV+A+0FWwVBEERRKwt/WpEzlkjRET3mJuHd/cdZmfBHy8alts0AVap7CRjUW0uPa8FH2kjKNFHOGO49mQiEeff9XaNT+WrIVXr/3N/rrZszjXA1yI8ZthOWVi6Ib5SthVvCHcZhUxWeE844kiDwudK1+v8oDhf5xfFTio5BX5VU8v/YP0HGwXHEg4L91vFivHdj7pJKFeanZHcI9GLS5IYUTR0KixRpMyQ5JLM7G/f8JdvmmXxGPK3qeKII09BvBFRK1I1J9kUPSdfkaqa++95uuboSL16KArN9573PADBTfioed77vud9HEDgDk5LDf+yzGn8VfRaQ+vfhY41OD5raPoWnKxD962dcTJfUkDCb5rwdATtaei8hNaF+qy+9zm8gdSqPNEFbO/AoJzvWPwEGUtoFQMm+ykAAAAcSURBVHicY+CLamyz8bjMZsgoEKUQcufee6UUAD5sBwy6fOBpAAAAAElFTkSuQmCC", "base64"),
    "plain.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHElEQVR4nGPgi2pss/G4zGbIKBClEHLn3nulFAA+bAcMunzgaQAAAABJRU5ErkJggg==", "base64"),
    "edit.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHElEQVR4nGPgi2pss/G4zGbIKBCloPTeQpGfCwA4HQUMR2wSSwAAAABJRU5ErkJggg==", "base64"),
    "srgb.icc": Buffer.from("AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACwAHAAsAIgAoYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c", "base64"),
};

for (const mode of ["buffered", "command"] as const) {
    it.each([
        ["profile.png", "plain.png", 0, "0 (0)", true],
        ["profile.png", "edit.png", 1, "10564.6 (0.161206)", true],
        ["plain.png", "profile.png", 0, "0 (0)", false],
        ["plain.png", "edit.png", 1, "10564.6 (0.161206)", false]
    ] as const)(`preserves only the first input's ICC: %s vs %s (${mode})`, async (first, second, exitCode, metric, hasProfile) => {
        const files = new Map(Object.entries(fixtures));
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const args = ["-metric", "RMSE", first, second, "diff.png"];
        let stderr = "";
        const result = mode === "buffered" ? runCompareCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(["compare", ...args]).args,
            fs, cwd: "/", env: {}, stdin: (async function* () {})(),
            signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(result.exitCode).toBe(exitCode);
        expect(("stderr" in result ? result.stderr as string : stderr).trim()).toBe(metric);
        const bytes = mode === "buffered" ? files.get("diff.png")! : await fs.readFile("/diff.png");
        const output = decodeImage(bytes);
        expect(output.icc).toEqual(hasProfile ? new Uint8Array(fixtures["srgb.icc"]) : undefined);
        expect(Buffer.from(bytes).includes(Buffer.from("iCCP"))).toBe(hasProfile);
        const rgb = output.data.filter((_, index) => index % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(exitCode === 0
            ? "121afb7ec34a92c7c8371d413e1ace40090fb15ebba6f5b42546d8dae2ffecca"
            : "3179cf1d5f4f8fe9c97e0f0888df68c7b1b0053c75d26e72ec71684da7e2c833");
    });
}
