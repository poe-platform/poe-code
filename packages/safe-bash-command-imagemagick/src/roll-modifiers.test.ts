import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including translucent RGBA pixels.
it.each([
    "+1!+1", "+1>+1", "+1^+1", "+1<+1", "+1@+1",
    "+1+1", "!+1+1", "+1+1!", "+1#+1", "+1%+1",
])("preserves native roll stdout for modifier geometry %s", async geometry => {
    const args = createCommandArguments([
        "xc:#11223340", "xc:#a0b0c080", "xc:#405060c0", "+append",
        "(", "xc:#d070a060", "xc:#3090a090", "xc:#e0a0f0b0", "+append", ")", "-append",
        "-roll", geometry, "-depth", "8", "rgba:-",
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
    expect(Buffer.concat(stdout).toString("hex")).toBe(geometry.includes("%")
        ? "11223340a0b0c080405060c0d070a0603090a090e0a0f0b0"
        : "e0a0f0b0d070a0603090a090405060c011223340a0b0c080");
});
