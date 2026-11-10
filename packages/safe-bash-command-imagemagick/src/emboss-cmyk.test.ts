import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, depth 8 raw output.
const cases = [
    { name: "unchanged black", operations: ["-colorspace", "CMYK", "-channel", "K", "-separate", "+channel"], format: "gray", expected: "9f7f6f" },
    { name: "embossed black", operations: ["-colorspace", "CMYK", "-channel", "K", "-emboss", "1x1", "-separate", "+channel"], format: "gray", expected: "ffaa55" },
    { name: "unchanged conversion", operations: ["-colorspace", "CMYK", "+channel", "-colorspace", "sRGB"], format: "rgba", expected: "305060ff507080ff908050ff" },
    { name: "black conversion", operations: ["-colorspace", "CMYK", "-channel", "K", "-emboss", "1x1", "+channel", "-colorspace", "sRGB"], format: "rgba", expected: "000000ff354a55ffaa975eff" },
    { name: "default inks", operations: ["-colorspace", "CMYK", "-emboss", "1x1", "+channel", "-colorspace", "sRGB"], format: "rgba", expected: "000000ff000000ff000000ff" },
    { name: "sRGB control", operations: ["-colorspace", "sRGB", "-emboss", "1x1", "+channel", "-colorspace", "sRGB"], format: "rgba", expected: "005555ff55aaffffffaa00ff" },
    ...[
        ["C", "305060ff007080ff908050ff"],
        ["M", "300060ff505580ff903050ff"],
        ["Y", "305060ff507080ff908000ff"],
        ["CMYK", "000000ff003955ffaa3900ff"],
        ["A", "305060ff507080ff908050ff"],
    ].map(([channel, expected]) => ({
        name: `${channel} selection`, operations: ["-colorspace", "CMYK", "-channel", channel!, "-emboss", "1x1", "+channel", "-colorspace", "sRGB"], format: "rgba", expected,
    })),
];
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each(cases)(`matches native $name (${mode})`, async ({ operations, format, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:#305060", "xc:#507080", "xc:#908050", "+append", ...operations, "-depth", "8", `${format}:/out.raw`];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
