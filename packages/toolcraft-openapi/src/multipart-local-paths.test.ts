import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const platforms = [
  {
    name: "win32",
    implementation: path.win32,
    cwd: "C:\\workspace",
    files: [
      ["C:\\images\\cat.png", "C:\\images\\cat.png"],
      ["C:/images/cat.png", "C:\\images\\cat.png"],
      ["D:\\images\\cat.png", "D:\\images\\cat.png"],
      ["C:cat.png", "C:\\workspace\\cat.png"],
      ["images\\cat.png", "C:\\workspace\\images\\cat.png"],
      ["\\\\server\\share\\cat.png", "\\\\server\\share\\cat.png"],
      ["\\images\\cat.png", "\\images\\cat.png"]
    ],
    missing: ["C:\\missing.png", "C:missing.png"]
  },
  {
    name: "posix",
    implementation: path.posix,
    cwd: "/workspace",
    files: [
      ["/images/cat.png", "/images/cat.png"],
      ["images/cat.png", "/workspace/images/cat.png"],
      ["./cat:1.png", "/workspace/cat:1.png"]
    ],
    missing: ["missing.png"]
  }
];

describe.each(platforms)("multipart local paths using $name", (platform) => {
  let prepareMultipartFileInputs: typeof import("./http.js")["prepareMultipartFileInputs"];

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("node:path", async () => {
      const actual = await vi.importActual<typeof import("node:path")>("node:path");
      return { ...actual, default: platform.implementation };
    });
    ({ prepareMultipartFileInputs } = await import("./http.js"));
  });

  afterAll(() => {
    vi.doUnmock("node:path");
    vi.resetModules();
  });

  it.each(platform.files)("reads %s from its native filesystem path", async (source, expectedPath) => {
    const data = Buffer.from("local image").toString("base64");
    const fs = {
      exists: vi.fn(async (filePath: string) => filePath === expectedPath),
      readFile: vi.fn(async () => data),
      writeFile: vi.fn(async () => undefined)
    };
    const fetchMock = vi.fn<typeof fetch>();

    const result = await prepareMultipartFileInputs({ body: { file: source } }, {
      bodyMode: "multipart",
      multipartBinaryFields: ["file"],
      env: { get: (key) => key === "INIT_CWD" ? platform.cwd : undefined },
      fs,
      fetch: fetchMock
    });

    expect(result.body).toEqual({
      file: { data, filename: platform.implementation.basename(expectedPath!), contentType: "image/png" }
    });
    expect(fs.exists).toHaveBeenCalledExactlyOnceWith(expectedPath);
    expect(fs.readFile).toHaveBeenCalledExactlyOnceWith(expectedPath, "base64");
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(platform.missing)("reports a missing local file for %s", async (source) => {
    const fs = {
      exists: vi.fn(async () => false),
      readFile: vi.fn(async () => ""),
      writeFile: vi.fn(async () => undefined)
    };
    const expectedPath = platform.implementation.isAbsolute(source)
      ? platform.implementation.normalize(source)
      : platform.implementation.resolve(platform.cwd, source);
    const fetchMock = vi.fn<typeof fetch>();

    await expect(prepareMultipartFileInputs({ body: { file: source } }, {
      bodyMode: "multipart",
      multipartBinaryFields: ["file"],
      env: { get: (key) => key === "INIT_CWD" ? platform.cwd : undefined },
      fs,
      fetch: fetchMock
    })).rejects.toThrow(`source ${JSON.stringify(source)} does not exist.`);

    expect(fs.exists).toHaveBeenCalledExactlyOnceWith(expectedPath);
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("continues to download remote URL sources", async () => {
    const fs = {
      exists: vi.fn(async () => false),
      readFile: vi.fn(async () => ""),
      writeFile: vi.fn(async () => undefined)
    };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("remote", {
      headers: { "content-type": "image/png" }
    }));

    const result = await prepareMultipartFileInputs({ body: { file: "https://files.example.test/cat.png" } }, {
      bodyMode: "multipart",
      multipartBinaryFields: ["file"],
      env: { get: (key) => key === "INIT_CWD" ? platform.cwd : undefined },
      fs,
      fetch: fetchMock
    });

    expect(result.body).toEqual({
      file: { data: Buffer.from("remote").toString("base64"), filename: "cat.png", contentType: "image/png" }
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fs.exists).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("retains plain base64 inputs when no local file exists", async () => {
    const data = Buffer.from("inline image").toString("base64");
    const fetchMock = vi.fn<typeof fetch>();

    const result = await prepareMultipartFileInputs({ body: { file: data } }, {
      bodyMode: "multipart",
      multipartBinaryFields: ["file"],
      env: { get: (key) => key === "INIT_CWD" ? platform.cwd : undefined },
      fs: { exists: async () => false, readFile: async () => "", writeFile: async () => undefined },
      fetch: fetchMock
    });

    expect(result.body).toEqual({ file: data });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
