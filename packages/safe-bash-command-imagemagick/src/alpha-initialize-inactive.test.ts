import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: full stdout, including 16-bit RGBA samples.
it.each([
  ...["Discrete", "Deactivate"].flatMap(mode => [
    { input: "xc:#123456", modes: [mode], output: "info", expected: "srgba 4.0" },
    { input: "xc:#123456", modes: [mode, "activate"], output: "rgba", expected: "121234345656ffff" },
    { input: "xc:#123456ff", modes: [mode, "activate"], output: "rgba", expected: "121234345656ffff" },
    { input: "xc:#12345680", modes: [mode, mode, "activate"], output: "rgba", expected: "1212343456568080" },
  ]),
  { input: "xc:#123456", modes: ["activate", "activate"], output: "rgba", expected: "1212343456560000" },
  { input: "xc:#123456", modes: [], output: "rgba", expected: "121234345656ffff" },
])("initializes missing alpha: $input $modes $output", async ({ input, modes, output, expected }) => {
  const args = createCommandArguments([input, ...modes.flatMap(mode => ["-alpha", mode]),
    ...(output === "info" ? ["-format", "%[channels]"] : ["-depth", "16", "-endian", "MSB"]), `${output}:-`]);
  let stdout = "", stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" },
    fs: new MemoryFileSystem(), stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex"); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});
