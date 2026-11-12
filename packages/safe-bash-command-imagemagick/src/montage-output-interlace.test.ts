import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete raw stdout from ImageMagick 7.1.2-35 Q16-HDRI for this P6 input.
const input = Buffer.concat([
  Buffer.from("P6\n2 2\n65535\n"),
  Buffer.from("123456789abcdef013572468101121223132414251526162", "hex")
]);

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { coder: "rgb", options: [], expected: "12569ade1324102131415161" },
    { coder: "rgb", options: ["-interlace", "none"], expected: "12569ade1324102131415161" },
    { coder: "rgb", options: ["-interlace", "line"], expected: "12de56139a24104121513161" },
    { coder: "rgb", options: ["-interlace", "plane"], expected: "12de1041561321519a243161" },
    { coder: "rgb", options: ["-interlace", "line", "+interlace"], expected: "12569ade1324102131415161" },
    { coder: "rgba", options: [], expected: "12569affde1324ff102131ff415161ff" },
    { coder: "rgba", options: ["-interlace", "none"], expected: "12569affde1324ff102131ff415161ff" },
    { coder: "rgba", options: ["-interlace", "line"], expected: "12de56139a24ffff104121513161ffff" },
    { coder: "rgba", options: ["-interlace", "plane"], expected: "12de1041561321519a243161ffffffff" },
    { coder: "rgba", options: ["-interlace", "plane", "-interlace", "none"], expected: "12569affde1324ff102131ff415161ff" }
  ])(`${mode} writes $coder montage output with $options`, async ({ coder, options, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const files = new Map([["/in.ppm", input]]);
    const args = ["/in.ppm", "-tile", "1x", "-geometry", "+0+0", "-depth", "8", ...options, `${coder}:-`];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const result = mode === "magick" || mode === "montage" ? await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}
