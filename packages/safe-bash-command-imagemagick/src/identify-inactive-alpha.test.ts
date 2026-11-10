import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const execution of ["command", "buffered", "sync"] as const) {
  it.each([
    { modes: ["deactivate"], output: "info", expected: "srgba 4.0" },
    { modes: ["discrete"], output: "info", expected: "srgba 4.0" },
    { modes: ["deactivate", "deactivate"], output: "info", expected: "srgba 4.0" },
    { modes: ["discrete", "extract"], output: "info", expected: "srgb  3.0" },
    { modes: ["deactivate", "remove"], output: "info", expected: "srgb  3.0" },
    { modes: ["deactivate", "set", "offifopaque"], output: "info", expected: "srgb  3.0" },
    { modes: ["off"], output: "info", expected: "srgb  3.0" },
    { modes: ["deactivate", "off"], output: "info", expected: "srgb  3.0" },
    { modes: ["discrete", "off"], output: "info", expected: "srgb  3.0" },
    { modes: ["deactivate", "extract"], output: "rgba", expected: "383838ff" },
    { modes: ["discrete", "extract"], output: "rgba", expected: "383838ff" }
  ])(`${execution}: reports retained channels for $modes with $output output`, async ({ modes, output, expected }) => {
    const argv = ["xc:#2060b038", ...modes.flatMap(mode => ["-alpha", mode]),
      "-depth", "8", "-format", "%[channels]", `${output}:out`];
    const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("out")!);
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = execution === "sync" ? runMagickCliSync(argv, files)
      : execution === "buffered" ? await runMagickCli(argv, files)
      : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const destination = execution === "command" ? await fs.readFile("/out") : files.get("out")!;
    expect(output === "rgba" ? Buffer.from(destination).toString("hex") : new TextDecoder().decode(destination)).toBe(expected);
  });
}
