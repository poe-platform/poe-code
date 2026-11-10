import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Raw RGBA stdout from native ImageMagick 7.1.2-35 Q16-HDRI.
it.each([
    ["+0x1.8+1", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
    ["+0x2.0+1", "a0b0c080405060c0112233403090a090e0a0f0b0d070a060"],
    ["-0x1.8-1", "a0b0c080405060c0112233403090a090e0a0f0b0d070a060"],
    ["+1+0", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
    ["+0x1.8", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
    ["+0x1+1", "e0a0f0b0d070a0603090a090405060c011223340a0b0c080"],
    ["+1.8+1", "e0a0f0b0d070a0603090a090405060c011223340a0b0c080"],
    ["+0X1.8+1", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
    ["3x2+0x1.8+1", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
    ["+1+0x1.8", "e0a0f0b0d070a0603090a090405060c011223340a0b0c080"],
    ["++0x1.8+1", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
    ["+0x1.8+1%", "11223340a0b0c080405060c0d070a0603090a090e0a0f0b0"],
    ["+0x1.8e1+1", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
    ["+0x1.8+1x2", "405060c011223340a0b0c080e0a0f0b0d070a0603090a090"],
])("matches native roll output for %s", async (geometry, expected) => {
    const args = createCommandArguments([
        "xc:#11223340", "xc:#a0b0c080", "xc:#405060c0", "+append",
        "(", "xc:#d070a060", "xc:#3090a090", "xc:#e0a0f0b0", "+append", ")", "-append",
        "-roll", geometry!, "-depth", "8", "rgba:-",
    ]);
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
});
