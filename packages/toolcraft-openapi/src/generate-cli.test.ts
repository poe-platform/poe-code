import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { stripAnsi } from "toolcraft-design";
import { generate, type OpenApiDocument } from "./generate.js";
import { runGenerateCli } from "./bin/generate.js";

function createSpec(summary: string): string {
  const document: OpenApiDocument = {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/bots": {
        get: {
          tags: ["bots"],
          operationId: "listBots",
          summary,
          responses: {
            "200": {
              description: "Listed.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  return JSON.stringify(document, null, 2);
}

function createEmptySpec(): string {
  const document: OpenApiDocument = {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {}
  };

  return JSON.stringify(document, null, 2);
}

function createCliHarness(initialFiles: Record<string, string> = {}) {
  const volume = Volume.fromJSON(initialFiles, "/");
  const fs = createFsFromVolume(volume).promises;
  let stdout = "";
  let stderr = "";

  return {
    fs,
    stdout: () => stdout,
    stderr: () => stderr,
    services: {
      cwd: "/repo",
      fs,
      fetch: vi.fn<typeof fetch>(),
      stdout: {
        write(chunk: string | Uint8Array) {
          stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        }
      },
      stderr: {
        write(chunk: string | Uint8Array) {
          stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        }
      }
    }
  };
}

function computeSpecSha(specText: string): string {
  return `sha256:${createHash("sha256").update(specText).digest("hex")}`;
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

function createExpectedFiles(
  specText: string,
  options?: {
    includeDownloadedSpec?: boolean;
    includeInputFile?: boolean;
    includeLockFile?: boolean;
  }
) {
  const specSha = computeSpecSha(specText);
  const generatedFiles = generate(JSON.parse(specText) as OpenApiDocument, { specSha });
  const expectedFiles = Object.fromEntries(
    generatedFiles.map((file) => [path.posix.join("src/generated", file.path), file.contents])
  );

  return {
    ...(options?.includeInputFile === false ? {} : { "openapi.json": specText }),
    ...(options?.includeLockFile === false
      ? {}
      : { "openapi.lock": `${JSON.stringify({ version: 1, specSha }, null, 2)}\n` }),
    ...(options?.includeDownloadedSpec === true ? { "src/generated/openapi.json": specText } : {}),
    ...expectedFiles
  };
}

async function readRepoFiles(
  fs: ReturnType<typeof createFsFromVolume>["promises"],
  directory: string,
  rootDir: string = directory
): Promise<Record<string, string>> {
  const entries = await fs.readdir(directory);
  const files: Record<string, string> = {};

  for (const entry of entries) {
    const absolutePath = path.posix.join(directory, entry);
    const stats = await fs.stat(absolutePath);

    if (stats.isDirectory()) {
      Object.assign(files, await readRepoFiles(fs, absolutePath, rootDir));
      continue;
    }

    files[path.posix.relative(rootDir, absolutePath)] = await fs.readFile(absolutePath, "utf8");
  }

  return files;
}

describe("runGenerateCli", () => {
  it("inspects every route without writing generated files", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": specText });
    const originalNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";

    try {
      const exitCode = await runGenerateCli(["node", "generate", "--inspect"], harness.services);

      expect(exitCode).toBe(0);
      expect(stripAnsi(harness.stdout())).toContain("Internal Agent API  v1.0.0");
      expect(stripAnsi(harness.stdout())).toContain("1 operation · 1 supported · 0 unsupported");
      expect(await readRepoFiles(harness.fs, "/repo")).toEqual({ "openapi.json": specText });
    } finally {
      if (originalNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = originalNoColor;
    }
  });

  it("renders complete JSON inspection output", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": specText });

    const exitCode = await runGenerateCli(
      ["node", "generate", "--inspect", "--output-format", "json"],
      harness.services
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(harness.stdout())).toMatchObject({
      operationCount: 1,
      supportedCount: 1,
      unsupportedCount: 0,
      operations: [{ operationId: "listBots", status: "supported" }]
    });
  });

  it("writes an explicit empty module when the spec has no operations", async () => {
    const specText = createEmptySpec();
    const harness = createCliHarness({ "/repo/openapi.json": specText });

    await runGenerateCli(["node", "generate"], harness.services);

    expect(await readRepoFiles(harness.fs, "/repo")).toEqual({
      "openapi.json": specText,
      "openapi.lock": `${JSON.stringify({ version: 1, specSha: computeSpecSha(specText) }, null, 2)}\n`,
      "src/generated/cli.ts":
        '#!/usr/bin/env node\n/**\n * Generated by toolcraft-openapi.\n */\nimport { configureTheme, runCLI } from "toolcraft/cli";\nimport * as groups from "./index.js";\n\nconfigureTheme({ brand: "blue", label: "Internal Agent API" });\n\nawait runCLI(Object.values(groups));\n',
      "src/generated/index.ts": "/**\n * Generated by toolcraft-openapi.\n */\nexport {};\n"
    });
  });

  it("creates generated files on the first run", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": specText });

    await runGenerateCli(["node", "generate"], harness.services);

    expect(await readRepoFiles(harness.fs, "/repo")).toEqual(createExpectedFiles(specText));
  });

  it("supports reading the spec from a URL and saves it next to generated files", async () => {
    const specText = createSpec("List bots from URL.");
    const harness = createCliHarness();
    harness.services.fetch.mockResolvedValue(
      new Response(specText, {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await runGenerateCli(
      ["node", "generate", "--input", "https://example.com/openapi.json"],
      harness.services
    );

    expect(await readRepoFiles(harness.fs, "/repo")).toEqual(
      createExpectedFiles(specText, { includeDownloadedSpec: true, includeInputFile: false })
    );
  });

  it("returns a user-facing error when fetching the spec fails with a network error", async () => {
    const harness = createCliHarness();
    harness.services.fetch.mockRejectedValue(new Error("socket hang up"));

    const exitCode = await runGenerateCli(
      ["node", "generate", "--input", "https://example.com/openapi.json"],
      harness.services
    );

    expect([exitCode, harness.stderr()]).toEqual([
      1,
      'Failed to read OpenAPI document "https://example.com/openapi.json": socket hang up\n'
    ]);
  });

  it("returns a user-facing error when fetching the spec returns a non-2xx response", async () => {
    const harness = createCliHarness();
    harness.services.fetch.mockResolvedValue(
      new Response("nope", {
        status: 503,
        statusText: "Service Unavailable"
      })
    );

    const exitCode = await runGenerateCli(
      ["node", "generate", "--input", "https://example.com/openapi.json"],
      harness.services
    );

    expect([exitCode, harness.stderr()]).toEqual([
      1,
      'Failed to fetch "https://example.com/openapi.json": 503 Service Unavailable (content-type: text/plain;charset=UTF-8)\n' +
        "  body: nope\n"
    ]);
  });

  it("returns a user-facing error when fetching the spec returns invalid JSON", async () => {
    const harness = createCliHarness();
    harness.services.fetch.mockResolvedValue(
      new Response('{"openapi": ', {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const exitCode = await runGenerateCli(
      ["node", "generate", "--input", "https://example.com/openapi.json"],
      harness.services
    );

    expect({
      exitCode,
      stderr: harness.stderr()
    }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining(
        'Failed to parse OpenAPI document "https://example.com/openapi.json":'
      )
    });
  });

  it("returns a user-facing error when fetching the spec times out", async () => {
    const harness = createCliHarness();
    harness.services.fetch.mockRejectedValue(
      Object.assign(new Error("Request timed out"), { name: "TimeoutError" })
    );

    const exitCode = await runGenerateCli(
      ["node", "generate", "--input", "https://example.com/openapi.json"],
      harness.services
    );

    expect([exitCode, harness.stderr()]).toEqual([
      1,
      'Failed to read OpenAPI document "https://example.com/openapi.json": Request timed out\n'
    ]);
  });

  it("is idempotent when the spec is unchanged", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": specText });

    await runGenerateCli(["node", "generate"], harness.services);
    const before = await readRepoFiles(harness.fs, "/repo");

    await runGenerateCli(["node", "generate"], harness.services);

    expect(await readRepoFiles(harness.fs, "/repo")).toEqual(before);
  });

  it("updates generated files when the spec changes", async () => {
    const originalSpec = createSpec("List bots.");
    const updatedSpec = createSpec("List every bot.");
    const harness = createCliHarness({ "/repo/openapi.json": originalSpec });

    await runGenerateCli(["node", "generate"], harness.services);
    await harness.fs.writeFile("/repo/openapi.json", updatedSpec, "utf8");

    await runGenerateCli(["node", "generate"], harness.services);

    expect(await readRepoFiles(harness.fs, "/repo")).toEqual(createExpectedFiles(updatedSpec));
  });

  it("returns a non-zero exit code and leaves files untouched when --check detects drift", async () => {
    const originalSpec = createSpec("List bots.");
    const updatedSpec = createSpec("List every bot.");
    const harness = createCliHarness({ "/repo/openapi.json": originalSpec });

    await runGenerateCli(["node", "generate"], harness.services);
    await harness.fs.writeFile("/repo/openapi.json", updatedSpec, "utf8");
    const before = await readRepoFiles(harness.fs, "/repo");

    const exitCode = await runGenerateCli(["node", "generate", "--check"], harness.services);

    expect([exitCode, await readRepoFiles(harness.fs, "/repo")]).toEqual([1, before]);
  });

  it("writes the OpenAPI lock file next to generated output", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": specText });

    const exitCode = await runGenerateCli(["node", "generate"], harness.services);

    expect(exitCode).toBe(0);
    expect(JSON.parse(await harness.fs.readFile("/repo/openapi.lock", "utf8"))).toEqual({
      version: 1,
      specSha: computeSpecSha(specText)
    });
  });

  it("supports a custom OpenAPI lock file path", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": specText });

    const exitCode = await runGenerateCli(
      ["node", "generate", "--lock", "locks/internal-agent.lock"],
      harness.services
    );

    expect(exitCode).toBe(0);
    expect(
      JSON.parse(await harness.fs.readFile("/repo/locks/internal-agent.lock", "utf8"))
    ).toEqual({
      version: 1,
      specSha: computeSpecSha(specText)
    });
  });

  it("treats a stale OpenAPI lock as drift in --check mode", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({
      "/repo/openapi.json": specText,
      ...Object.fromEntries(
        Object.entries(createExpectedFiles(specText, { includeInputFile: false })).map(
          ([filePath, contents]) => [`/repo/${filePath}`, contents]
        )
      ),
      "/repo/openapi.lock": JSON.stringify({ version: 1, specSha: "sha256:stale" }, null, 2)
    });

    const before = await readRepoFiles(harness.fs, "/repo");
    const exitCode = await runGenerateCli(["node", "generate", "--check"], harness.services);

    expect([exitCode, await readRepoFiles(harness.fs, "/repo")]).toEqual([1, before]);
    expect(harness.stderr()).toContain(
      "OpenAPI output is out of date for src/generated. Run the generator without --check to update it."
    );
  });

  it("returns diagnostics from toolcraft.yml in --check mode", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({
      "/repo/openapi.json": specText,
      ...Object.fromEntries(
        Object.entries(createExpectedFiles(specText, { includeInputFile: false })).map(
          ([filePath, contents]) => [`/repo/${filePath}`, contents]
        )
      ),
      "/repo/toolcraft.yml": [
        "edition: 2026-05-16",
        "resources:",
        "  bots:",
        "    methods:",
        "      list: get /bots { pagination: cursor }"
      ].join("\n")
    });

    const exitCode = await runGenerateCli(["node", "generate", "--check"], harness.services);

    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("TOOLCRAFT_OPENAPI_003");
    expect(harness.stderr()).toContain("resources.bots.methods.list");
    expect(harness.stderr()).toContain("OpenAPI diagnostics failed for toolcraft.yml.");
    expect(harness.stderr()).not.toContain("OpenAPI output is out of date");
  });

  it("fails normal generation without writing files when toolcraft.yml has error diagnostics", async () => {
    const specText = createSpec("List bots.");
    const configText = [
      "edition: 2025-01-01",
      "resources:",
      "  bots:",
      "    methods:",
      "      list: get /bots"
    ].join("\n");
    const harness = createCliHarness({
      "/repo/openapi.json": specText,
      "/repo/toolcraft.yml": configText
    });

    const exitCode = await runGenerateCli(["node", "generate"], harness.services);

    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("TOOLCRAFT_OPENAPI_006");
    expect(harness.stderr()).toContain("OpenAPI diagnostics failed for toolcraft.yml.");
    expect(harness.stdout()).toBe("");
    expect(await readRepoFiles(harness.fs, "/repo")).toEqual({
      "openapi.json": specText,
      "toolcraft.yml": configText
    });
  });

  it("uses toolcraft.yml resource method names to shape generated files", async () => {
    const document = JSON.parse(createSpec("List bots.")) as OpenApiDocument;
    document.paths = {
      "/bots": {
        post: {
          operationId: "createBot",
          summary: "Create a bot.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: { name: { type: "string" } }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Created.",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      }
    };
    const harness = createCliHarness({
      "/repo/openapi.json": JSON.stringify(document, null, 2),
      "/repo/toolcraft.yml": [
        "edition: 2026-05-16",
        "client_settings:",
        "  idempotency_header: Idempotency-Key",
        "resources:",
        "  bots:",
        "    methods:",
        "      create: post /bots { idempotent: true }",
        "readme:",
        "  examples:",
        "    bots.create:",
        "      - title: Create a named bot",
        "        params:",
        "          name: demo"
      ].join("\n")
    });

    const exitCode = await runGenerateCli(["node", "generate"], harness.services);

    expect(exitCode).toBe(0);
    expect(await readRepoFiles(harness.fs, "/repo/src/generated")).toMatchObject({
      "bots/create.ts": expect.stringContaining('name: "create"')
    });
    const generated = await harness.fs.readFile("/repo/src/generated/bots/create.ts", "utf8");
    expect(generated).toContain("idempotencyKey: S.Optional");
    expect(generated).toContain('header: "Idempotency-Key"');
    expect(generated).toContain("rawResponse: S.Optional");
    expect(generated).toContain('cliAliases: ["raw"]');
    expect(generated).toContain("rawResponse: params.rawResponse");
    expect(generated).toContain('"title":"Create a named bot"');
    expect(generated).toContain('"params":{"name":"demo"}');
  });

  it("prints a diff without writing files when --diff detects drift", async () => {
    const originalSpec = createSpec("List bots.");
    const updatedSpec = createSpec("List every bot.");
    const harness = createCliHarness({ "/repo/openapi.json": originalSpec });

    await runGenerateCli(["node", "generate"], harness.services);
    await harness.fs.writeFile("/repo/openapi.json", updatedSpec, "utf8");
    const before = await readRepoFiles(harness.fs, "/repo");

    const exitCode = await runGenerateCli(["node", "generate", "--diff"], harness.services);

    expect(exitCode).toBe(1);
    expect(await readRepoFiles(harness.fs, "/repo")).toEqual(before);
    expect(harness.stdout()).toContain("--- src/generated/bots/list.ts");
    expect(harness.stdout()).toContain('-  description: "List bots.",');
    expect(harness.stdout()).toContain('+  description: "List every bot.",');
    expect(harness.stdout()).not.toContain('-import { S } from "toolcraft";');
  });

  it("returns a user-facing error when the input file is missing", async () => {
    const harness = createCliHarness();

    const exitCode = await runGenerateCli(["node", "generate"], harness.services);

    expect([exitCode, harness.stderr()]).toEqual([
      1,
      "Failed to read OpenAPI document \"openapi.json\": ENOENT: no such file or directory, open '/repo/openapi.json'\n"
    ]);
  });

  it("rethrows output directory stat failures with inherited missing-path codes", async () => {
    const specText = createEmptySpec();
    const harness = createCliHarness({ "/repo/openapi.json": specText });
    const statError = new Error("stat failed");
    const lstat = harness.services.fs.lstat.bind(harness.services.fs);
    vi.spyOn(harness.services.fs, "lstat").mockImplementation(async (targetPath) => {
      if (String(targetPath) === "/repo/src/generated") {
        throw statError;
      }
      return lstat(targetPath);
    });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toBe(statError);
    });
  });

  it("returns an internal-invariant error for ToolcraftBugError-like failures", async () => {
    const specText = createEmptySpec();
    const harness = createCliHarness({ "/repo/openapi.json": specText });
    const error = new Error("generated command node is missing source metadata.");
    error.name = "ToolcraftBugError";
    vi.spyOn(harness.services.fs, "writeFile").mockRejectedValueOnce(error);

    const exitCode = await runGenerateCli(["node", "generate"], harness.services);

    expect([exitCode, harness.stderr()]).toEqual([
      1,
      "toolcraft hit an internal invariant: generated command node is missing source metadata.\n" +
        "This is a bug in toolcraft or in the command definition; " +
        "it cannot be worked around by changing argv. " +
        "File an issue.\n"
    ]);
  });

  it("rethrows ordinary unexpected write failures", async () => {
    const specText = createEmptySpec();
    const harness = createCliHarness({ "/repo/openapi.json": specText });
    vi.spyOn(harness.services.fs, "writeFile").mockRejectedValueOnce(new Error("disk full"));

    await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toThrow(
      new Error("disk full")
    );
    expect(harness.stderr()).toBe("");
  });

  it("cleans up temp files for write failures with inherited existing-path codes", async () => {
    const specText = createEmptySpec();
    const harness = createCliHarness({ "/repo/openapi.json": specText });
    const writeError = new Error("disk full");
    const writeFile = harness.services.fs.writeFile.bind(harness.services.fs);
    const unlink = vi.spyOn(harness.services.fs, "unlink");
    let stagedPath: string | undefined;
    vi.spyOn(harness.services.fs, "writeFile").mockImplementation(
      async (filePath, contents, encoding) => {
        const pathText = String(filePath);
        if (pathText.startsWith("/repo/src/generated/.index.ts.") && pathText.endsWith(".tmp")) {
          stagedPath = pathText;
          throw writeError;
        }

        return writeFile(filePath, contents, encoding);
      }
    );

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toBe(writeError);
    });

    expect(stagedPath).toBeDefined();
    expect(unlink).toHaveBeenCalledWith(stagedPath);
  });

  it("restores the previous generated client when a later output write fails", async () => {
    const originalSpec = createEmptySpec();
    const updatedSpec = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": originalSpec });

    await runGenerateCli(["node", "generate"], harness.services);
    const before = await readRepoFiles(harness.fs, "/repo");
    await harness.fs.writeFile("/repo/openapi.json", updatedSpec, "utf8");

    const writeFile = harness.services.fs.writeFile.bind(harness.services.fs);
    let indexWriteFailed = false;
    let stagedPath: string | undefined;
    vi.spyOn(harness.services.fs, "writeFile").mockImplementation(
      async (filePath, contents, encoding) => {
        const pathText = String(filePath);
        if (
          pathText.startsWith("/repo/src/generated/.index.ts.") &&
          pathText.endsWith(".tmp") &&
          !indexWriteFailed
        ) {
          indexWriteFailed = true;
          stagedPath = pathText;
          await writeFile(filePath, String(contents).slice(0, 12), encoding);
          throw new Error("disk full during index write");
        }

        return writeFile(filePath, contents, encoding);
      }
    );

    await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toThrow(
      new Error("disk full during index write")
    );

    expect(await readRepoFiles(harness.fs, "/repo")).toEqual({
      ...before,
      "openapi.json": updatedSpec
    });
    expect(stagedPath).toBeDefined();
    await expect(harness.fs.lstat(stagedPath as string)).rejects.toThrow("ENOENT");
  });

  it("rejects a symlinked generated output directory", async () => {
    const specText = createEmptySpec();
    const harness = createCliHarness({ "/repo/openapi.json": specText, "/outside/marker": "keep" });
    await harness.fs.mkdir("/repo/src", { recursive: true });
    await harness.fs.symlink("/outside", "/repo/src/generated");

    await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toThrow(
      "Generated output must remain inside the output directory."
    );
    await expect(harness.fs.readFile("/outside/index.ts", "utf8")).rejects.toThrow();
  });

  it("does not follow generated file symlinks inserted during publish", async () => {
    const specText = createEmptySpec();
    const harness = createCliHarness({
      "/repo/openapi.json": specText,
      "/outside/index.ts": "outside-state\n"
    });
    const writeFile = harness.services.fs.writeFile.bind(harness.services.fs);
    let stagedPath: string | undefined;

    vi.spyOn(harness.services.fs, "writeFile").mockImplementation(
      async (filePath, contents, encoding) => {
        const pathText = String(filePath);
        if (
          stagedPath === undefined &&
          pathText.startsWith("/repo/src/generated/.index.ts.") &&
          pathText.endsWith(".tmp")
        ) {
          stagedPath = pathText;
          await harness.fs.symlink("/outside/index.ts", "/repo/src/generated/index.ts");
        }

        return writeFile(filePath, contents, encoding);
      }
    );

    await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toThrow(
      "Generated output must remain inside the output directory."
    );

    expect(stagedPath).toBeDefined();
    await expect(harness.fs.readFile("/outside/index.ts", "utf8")).resolves.toBe("outside-state\n");
    await expect(harness.fs.lstat(stagedPath as string)).rejects.toThrow("ENOENT");
    expect((await harness.fs.lstat("/repo/src/generated/index.ts")).isSymbolicLink()).toBe(true);
  });

  it("rejects symlinked generated descendants during stale cleanup", async () => {
    const specText = createEmptySpec();
    const expectedFiles = createExpectedFiles(specText);
    const generatedIndex = expectedFiles["src/generated/index.ts"];

    if (generatedIndex === undefined) {
      throw new Error("Expected generated index file.");
    }

    const harness = createCliHarness({
      "/repo/openapi.json": specText,
      "/repo/src/generated/index.ts": generatedIndex,
      "/outside/stale.ts": "keep"
    });
    await harness.fs.symlink("/outside", "/repo/src/generated/linked");

    await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toThrow(
      "Generated output must remain inside the output directory."
    );
    await expect(harness.fs.readFile("/outside/stale.ts", "utf8")).resolves.toBe("keep");
  });

  it("rejects a symlinked generated child directory", async () => {
    const specText = createSpec("List bots.");
    const harness = createCliHarness({ "/repo/openapi.json": specText, "/outside/marker": "keep" });
    await harness.fs.mkdir("/repo/src/generated", { recursive: true });
    await harness.fs.symlink("/outside", "/repo/src/generated/bots");

    await expect(runGenerateCli(["node", "generate"], harness.services)).rejects.toThrow(
      "Generated output must remain inside the output directory."
    );
    await expect(harness.fs.readFile("/outside/list.ts", "utf8")).rejects.toThrow();
  });
});
