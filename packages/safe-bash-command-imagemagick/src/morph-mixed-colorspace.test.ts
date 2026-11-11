import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including unchanged endpoints.
for (const mode of ["map", "sync", "filesystem", "command"])
it.each([
    { first: "Lab", second: "CMYK", alpha: true, expected: "345caa80251e8460cc359a40" },
    { first: "HSL", second: "CMYK", alpha: true, expected: "345caa80328e2060cc359a40" },
    { first: "DisplayP3", second: "CMYK", alpha: true, expected: "345caa8000987d60cc359a40" },
    { first: "Lab", second: "CMYK", alpha: false, expected: "345caaff251e84ffcc359aff" },
    { first: "Lab", second: "sRGB", alpha: true, expected: "345caa8028a0a160cc359a40" },
    { first: "CMYK", second: "Lab", alpha: true, expected: "345caa8045428760cc359a40" },
    { first: "Lab", second: "Lab", alpha: true, expected: "345caa808f51a260cc359a40" },
    { first: "Lab", second: "CMYK", alpha: false, conversion: ["-delete", "0,2", "-channel", "R", "-separate"], format: "gray", expected: "33" },
    { first: "Lab", second: "CMYK", alpha: true, conversion: ["-channel", "A", "-separate"], format: "gray", expected: "806040" }
])(`morphs $first into $second (alpha=$alpha, ${mode})`, async ({ first, second, alpha, conversion = ["-colorspace", "sRGB"], format = "rgba", expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = ["(", `xc:#345caa${alpha ? "80" : ""}`, "-colorspace", first, ")", "(", `xc:#cc359a${alpha ? "40" : ""}`, "-colorspace", second, ")", "-morph", "1", ...conversion, "-depth", "8", `${format}:/out`];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
