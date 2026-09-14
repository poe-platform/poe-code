import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const document = {
  openapi: "3.0.3",
  info: { title: "Path audit", version: "1" },
  paths: {
    "/widgets": {
      get: {
        tags: ["widgets"],
        operationId: "listWidgets",
        responses: {
          "200": {
            description: "Ready",
            content: {
              "application/json": {
                schema: { type: "array", items: { type: "string" } },
                example: ["ready"]
              }
            }
          }
        }
      }
    }
  }
};

const platforms = [
  {
    name: "win32",
    implementation: path.win32,
    cwd: "C:\\workspace",
    files: [
      ["C:\\specs\\openapi.json", "C:\\specs\\openapi.json"],
      ["C:/specs/openapi.json", "C:\\specs\\openapi.json"],
      ["D:\\team specs\\openapi.json", "D:\\team specs\\openapi.json"],
      ["C:openapi.json", "C:\\workspace\\openapi.json"],
      ["specs\\openapi.json", "C:\\workspace\\specs\\openapi.json"],
      ["\\\\server\\share\\openapi.json", "\\\\server\\share\\openapi.json"],
      ["\\specs\\openapi.json", "C:\\specs\\openapi.json"]
    ],
    missing: "C:\\missing.json"
  },
  {
    name: "posix",
    implementation: path.posix,
    cwd: "/workspace",
    files: [
      ["/specs/openapi.json", "/specs/openapi.json"],
      ["specs/openapi.json", "/workspace/specs/openapi.json"],
      ["./spec:1.json", "/workspace/spec:1.json"]
    ],
    missing: "/missing.json"
  }
];

function createFileSystem(expectedPath: string, contents = JSON.stringify(document)) {
  const missing = Object.assign(new Error("fixture file not found"), { code: "ENOENT" });
  return {
    readFile: vi.fn(async (filePath: string) => {
      if (filePath === expectedPath) return contents;
      throw missing;
    }),
    lstat: vi.fn(async () => { throw missing; }),
    readdir: vi.fn(async () => [] as string[]),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    realpath: vi.fn(async (filePath: string) => filePath),
    unlink: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined)
  };
}

describe.each(platforms)("specification paths using $name", (platform) => {
  let readOpenApiSourceText: typeof import("./spec-source.js")["readOpenApiSourceText"];
  let parseOpenApiDocument: typeof import("./spec-source.js")["parseOpenApiDocument"];
  let inspectOpenApiSource: typeof import("./inspect-source.js")["inspectOpenApiSource"];
  let commandsFromSpec: typeof import("./runtime.js")["commandsFromSpec"];
  let mockFetch: typeof import("./mock/fetch.js")["mockFetch"];
  let runGenerateCli: typeof import("./bin/generate.js")["runGenerateCli"];

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("node:path", async () => {
      const actual = await vi.importActual<typeof import("node:path")>("node:path");
      return { ...actual, default: platform.implementation };
    });
    ({ readOpenApiSourceText, parseOpenApiDocument } = await import("./spec-source.js"));
    ({ inspectOpenApiSource } = await import("./inspect-source.js"));
    ({ commandsFromSpec } = await import("./runtime.js"));
    ({ mockFetch } = await import("./mock/fetch.js"));
    ({ runGenerateCli } = await import("./bin/generate.js"));
  });

  afterAll(() => {
    vi.doUnmock("node:path");
    vi.resetModules();
  });

  describe.each(["reader", "inspection", "runtime", "mock", "generator inspect", "generator check"])(
    "%s",
    (consumer) => {
      it.each(platform.files)("reads %s as a native local file", async (source, expectedPath) => {
        const fs = createFileSystem(expectedPath!);
        const fetch = vi.fn<typeof globalThis.fetch>();
        const options = { cwd: platform.cwd, fs, fetch };

        if (consumer === "reader") {
          expect(await readOpenApiSourceText(source!, options)).toBe(JSON.stringify(document));
        } else if (consumer === "inspection") {
          expect(await inspectOpenApiSource(source!, options)).toMatchObject({
            operationCount: 1, supportedCount: 1
          });
        } else if (consumer === "runtime") {
          expect(await commandsFromSpec(source!, { ...options, cache: false })).toHaveLength(1);
        } else if (consumer === "mock") {
          const handle = await mockFetch({ spec: source!, ...options });
          expect(await (await handle.fetch("https://example.test/widgets")).json()).toEqual(["ready"]);
          expect(handle.requests).toHaveLength(1);
        } else {
          const stdout = { write: vi.fn<(chunk: string | Uint8Array) => boolean>(() => true) };
          const stderr = { write: vi.fn<(chunk: string | Uint8Array) => boolean>(() => true) };
          const inspect = consumer === "generator inspect";
          const code = await runGenerateCli([
            "node", "toolcraft-openapi-generate", "--input", source!,
            ...(inspect ? ["--inspect", "--output-format", "json"] : ["--check"])
          ], { ...options, stdout, stderr });

          expect(code).toBe(inspect ? 0 : 1);
          if (inspect) {
            expect(JSON.parse(String(stdout.write.mock.calls[0]?.[0]))).toMatchObject({ operationCount: 1 });
            expect(stderr.write).not.toHaveBeenCalled();
          } else {
            expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("OpenAPI output is out of date"));
          }
        }

        expect(fs.readFile).toHaveBeenNthCalledWith(1, expectedPath, "utf8");
        expect(fetch).not.toHaveBeenCalled();
        expect(fs.mkdir).not.toHaveBeenCalled();
        expect(fs.rename).not.toHaveBeenCalled();
        expect(fs.rm).not.toHaveBeenCalled();
        expect(fs.unlink).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
      });
    }
  );

  it("retains a local-file error for missing native paths", async () => {
    const fs = createFileSystem("not the requested file");
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(readOpenApiSourceText(platform.missing, { cwd: platform.cwd, fs, fetch }))
      .rejects.toThrow(`Failed to read OpenAPI document ${JSON.stringify(platform.missing)}: fixture file not found`);

    expect(fs.readFile).toHaveBeenCalledExactlyOnceWith(platform.missing, "utf8");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the original native path in parse diagnostics", () => {
    expect(() => parseOpenApiDocument("[invalid", platform.missing))
      .toThrow(`Failed to parse OpenAPI document ${JSON.stringify(platform.missing)}`);
  });

  it.each(["https://example.test/openapi.json", new URL("https://example.test/openapi.json")])(
    "continues to fetch URL input %s",
    async (source) => {
      const fs = createFileSystem("unused");
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(document)));

      expect(await readOpenApiSourceText(source, { cwd: platform.cwd, fs, fetch }))
        .toBe(JSON.stringify(document));
      expect(fetch).toHaveBeenCalledExactlyOnceWith("https://example.test/openapi.json");
      expect(fs.readFile).not.toHaveBeenCalled();
    }
  );

  it.each(["file:///specs/openapi.json", new URL("file:///specs/openapi.json")])(
    "retains native URL-to-file conversion for %s",
    async (source) => {
      const expectedPath = fileURLToPath(source);
      const fs = createFileSystem(expectedPath);
      const fetch = vi.fn<typeof globalThis.fetch>();

      expect(await readOpenApiSourceText(source, { cwd: platform.cwd, fs, fetch }))
        .toBe(JSON.stringify(document));
      expect(fs.readFile).toHaveBeenCalledExactlyOnceWith(expectedPath, "utf8");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
