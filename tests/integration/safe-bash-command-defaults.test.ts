import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createCsvkitCommand } from "safe-bash-command-csvkit";
import { createFmtCommand, fmtCommand } from "safe-bash-command-fmt";
import { createImagemagickCommand, createMagickCommand } from "safe-bash-command-imagemagick";
import { createOpCommand, createOpCommands } from "safe-bash-command-op";
import { createPandocCommands } from "safe-bash-command-pandoc";
import { createSsconvertCommand } from "safe-bash-command-ssconvert";
import { createXmllintCommand } from "safe-bash-command-xmllint";
import { createXzCommand, createXzCommands } from "safe-bash-command-xz";

async function run(
  command: CommandDefinition,
  args: string[],
  input = "",
  fs = new MemoryFileSystem()
) {
  const stdout: Uint8Array[] = [],
    stderr: Uint8Array[] = [];
  const result = await command.execute({
    command: command.name,
    ...createCommandArguments(args),
    cwd: "/",
    env: {},
    fs,
    signal: new AbortController().signal,
    stdin: toByteSource(input),
    stdout: {
      async write(bytes) {
        stdout.push(bytes.slice());
      }
    },
    stderr: {
      async write(bytes) {
        stderr.push(bytes.slice());
      }
    }
  });
  const decode = (chunks: Uint8Array[]) => new TextDecoder().decode(Buffer.concat(chunks));
  return { ...result, stdout: decode(stdout), stderr: decode(stderr) };
}

describe("new default command entrypoints", () => {
  it("preserves the existing fmt and ImageMagick factory aliases", () => {
    expect(createFmtCommand).toBe(fmtCommand);
    expect(createImagemagickCommand).toBe(createMagickCommand);
    expect(createImagemagickCommand().name).toBe("magick");
  });

  it("uses isolated empty op backends and preserves supplied backend behavior", async () => {
    expect(await run(createOpCommand(), ["--version"])).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await run(createOpCommands()[0]!, ["vault", "list", "--format", "json"])).toMatchObject({
      exitCode: 0,
      stdout: "[]\n"
    });
    let calls = 0;
    const command = createOpCommands({
      backend: {
        async execute() {
          calls++;
          return [{ name: "Test vault" }];
        }
      }
    })[0]!;
    expect((await run(command, ["vault", "list", "--format", "json"])).stdout).toContain(
      "Test vault"
    );
    expect(calls).toBe(1);
    expect((await run(createOpCommands()[0]!, ["vault", "list", "--format", "json"])).stdout).toBe(
      "[]\n"
    );
  });

  it("runs xmllint against stdin and relative virtual files with its default runtime", async () => {
    expect(
      await run(createXmllintCommand(), ["--xpath", "count(/root/item)"], "<root><item/></root>")
    ).toEqual({ exitCode: 0, stdout: "1\n", stderr: "" });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.xml", new TextEncoder().encode('<root b="2" a="1"/>'));
    expect(await run(createXmllintCommand(), ["--c14n", "input.xml"], "", fs)).toEqual({
      exitCode: 0,
      stdout: '<root a="1" b="2"></root>',
      stderr: ""
    });
    expect(
      (await run(createXmllintCommand({ limits: { maxInputBytes: 2 } }), ["--noout"], "<root/>"))
        .exitCode
    ).not.toBe(0);
  });

  it("executes the csvkit primary and selected commands and enforces configured limits", async () => {
    expect(createCsvkitCommand().name).toBe("csvclean");
    expect((await run(createCsvkitCommand(), ["--help"])).exitCode).toBe(0);
    expect(
      await run(createCsvkitCommand({}, "csvcut"), ["-c", "name"], "name,age\nAda,36\n")
    ).toEqual({ exitCode: 0, stdout: "name\nAda\n", stderr: "" });
    expect(
      (
        await run(
          createCsvkitCommand({ limits: { maxInputBytes: 2 } }, "csvcut"),
          ["-c", "name"],
          "name,age\nAda,36\n"
        )
      ).exitCode
    ).not.toBe(0);
    expect(() => createCsvkitCommand({}, "missing")).toThrow("Unknown csvkit command");
  });

  it("runs default pandoc and ssconvert commands", async () => {
    expect(
      await run(createPandocCommands()[0]!, ["-f", "commonmark", "-t", "plain"], "Hello\n")
    ).toEqual({ exitCode: 0, stdout: "Hello\n", stderr: "" });
    expect((await run(createSsconvertCommand(), ["--help"])).exitCode).toBe(0);
  });

  it("converts buffered virtual files with ssconvert defaults and preserves explicit read limits", async () => {
    const fs = new Proxy(new MemoryFileSystem(), {
      get(target, key) {
        if (key === "readStream") return undefined;
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const source = new TextEncoder().encode("1,2\n3,4\n");
    await fs.writeFile("/input.csv", source);
    const args = [
      "-I", "Gnumeric_stf:stf_csvtab", "-T", "Gnumeric_stf:stf_csv",
      "/input.csv", "/output.csv"
    ];
    expect(await run(createSsconvertCommand(), args, "", fs)).toMatchObject({
      exitCode: 0, stdout: "", stderr: ""
    });
    expect(await fs.readFile("/output.csv")).toEqual(source);
    const sentinel = new TextEncoder().encode("preserved");
    await fs.writeFile("/output.csv", sentinel);
    await expect(
      run(createSsconvertCommand({ limits: { inputBytes: 2 } }), args, "", fs)
    ).rejects.toMatchObject({ code: "EFBIG" });
    expect(await fs.readFile("/output.csv")).toEqual(sentinel);
    expect((await fs.readdir("/")).map((entry) => entry.name).sort()).toEqual([
      "input.csv", "output.csv"
    ]);
  });

  it("preserves xz aliases and validates the single-command resource bound", async () => {
    expect(createXzCommands().map((command) => command.name)).toContain("unxz");
    expect((await run(createXzCommand(), ["--help"])).stdout).toContain("Usage: xz");
    expect(() => createXzCommand({ maxDecodedBytes: -1 })).toThrow(RangeError);
  });
});
