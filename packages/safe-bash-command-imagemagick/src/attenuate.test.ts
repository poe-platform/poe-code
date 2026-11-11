import { describe, expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: attenuation is a setting, independent of -evaluate noise.
describe.each(["command", "retained", "buffered", "sync"] as const)("attenuate (%s)", mode => {
  async function run(argv: string[]) {
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    const output = mode === "command" ? Buffer.concat(chunks)
      : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
    return { exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr, output };
  }

  it.each([
    { settings: ["-attenuate", "0"], expected: "0" },
    { settings: ["-attenuate", "1"], expected: "1" },
    { settings: ["-attenuate", "0.50"], expected: "0.50" },
    { settings: ["-attenuate", "-2"], expected: "-2" },
    { settings: ["-attenuate", "50%"], expected: "50%" },
    { settings: ["-attenuate", "1x2"], expected: "1x2" },
    { settings: ["-attenuate", "0", "+attenuate"], expected: "1.0" },
    { settings: ["+attenuate"], expected: "1.0" },
    { settings: ["-set", "option:amount", "0.25", "-attenuate", "%[option:amount]"], expected: "0.25" },
    { settings: ["-attenuate", "0", "-attenuate", "2"], expected: "2" }
  ])("exposes the option value for $settings before and after input", async ({ settings, expected }) => {
    for (const input of [[...settings, "xc:#808080"], ["xc:#808080", ...settings]]) {
      const result = await run([...input, "-format", "%[attenuate]|%[option:attenuate]", "info:"]);
      expect(result).toEqual({ exitCode: 0, stderr: "", output: Buffer.from(`${expected}|${expected}`) });
    }
  });

  it.each([undefined, "0", "1"])("preserves pixels and independent evaluate noise with attenuation %s", async value => {
    for (const noise of [false, true]) {
      const result = await run(["-seed", "7", "-size", "2x1", "xc:#808080",
        ...(value === undefined ? [] : ["-attenuate", value]),
        ...(noise ? ["-evaluate", "Uniform-noise", "1"] : []), "-depth", "8", "rgba:-"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.output.toString("hex")).toBe(noise ? "80817fff828281ff" : "808080ff808080ff");
    }
  });

  it.each(["", "abc", "nan"])("rejects invalid attenuation %j", async value => {
    const result = await run(["xc:red", "-attenuate", value, "null:"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid argument for option '-attenuate'");
    expect(result.output.length).toBe(0);
  });
});

it.each(["retained", "buffered", "sync"] as const)("accepts attenuation in mogrify (%s)", async mode => {
  const input = new TextEncoder().encode("P3\n2 1\n255\n128 128 128 128 128 128\n");
  const files = new Map([["/input.ppm", input]]);
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.ppm", input);
  const argv = ["-attenuate", "0", "+attenuate", "/input.ppm"];
  const result = mode === "sync" ? runMogrifyCliSync(argv, files)
    : await runMogrifyCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const output = mode === "retained" ? await filesystem.readFile("/input.ppm") : files.get("/input.ppm")!;
  expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe("808080ff808080ff");
});
