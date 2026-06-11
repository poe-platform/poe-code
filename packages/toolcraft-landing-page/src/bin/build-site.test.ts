import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { buildSite } from "./build-site.js";

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code
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

describe("buildSite", () => {
  it("writes a non-empty self-contained HTML document", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const outputDirectory = "/package/dist-site";

    await buildSite({ fs, outputDirectory });

    const html = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");
    await buildSite({ fs, outputDirectory });
    const rebuiltHtml = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");

    expect(html.length).toBeGreaterThan(0);
    expect(rebuiltHtml).toBe(html);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).toContain("npm install toolcraft toolcraft-schema");
    expect(html).toContain("0.0.4");
    expect(html).toContain('href="https:&#x2F;&#x2F;github.com&#x2F;poe-platform&#x2F;poe-code"');
    expect(html).not.toMatch(/<link\b[^>]*\bhref=/i);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
    const docsHtml = await fs.readFile(path.join(outputDirectory, "docs", "index.html"), "utf8");
    expect(docsHtml).toContain("Toolcraft guide");
    expect(docsHtml).toContain('id="first-command"');
    expect(docsHtml).toContain('id="runtime-surfaces"');
    expect(docsHtml).toContain('id="safety"');
    expect(docsHtml).toContain('id="migration"');
    expect(docsHtml).toContain("npm install toolcraft toolcraft-schema");
    expect(docsHtml).not.toMatch(/<link\b[^>]*\bhref=/i);
    expect(docsHtml).not.toMatch(/<script\b[^>]*\bsrc=/i);
    await expect(fs.readFile(path.join(outputDirectory, ".nojekyll"), "utf8")).resolves.toBe("");
  });

  it("preserves prior output when rebuilding HTML fails", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const outputDirectory = "/package/dist-site";
    await buildSite({ fs, outputDirectory });
    const originalHtml = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");
    const failingFs = {
      async mkdir(directoryPath: string, options: { recursive: true }) {
        await fs.mkdir(directoryPath, options);
      },
      async rename(sourcePath: string, destinationPath: string) {
        await fs.rename(sourcePath, destinationPath);
      },
      async rm(filePath: string, options: { force: true }) {
        await fs.rm(filePath, options);
      },
      async writeFile(
        filePath: string,
        contents: string,
        options: { encoding: "utf8"; flag?: string }
      ) {
        if (filePath.startsWith("/package/dist-site/index.html.")) {
          await fs.writeFile(filePath, "partial", options);
          throw new Error("html write failed");
        }
        await fs.writeFile(filePath, contents, options);
      }
    };

    await expect(buildSite({ fs: failingFs, outputDirectory })).rejects.toThrow(
      "html write failed"
    );

    await expect(fs.readFile(path.join(outputDirectory, "index.html"), "utf8")).resolves.toBe(
      originalHtml
    );
    const entries = await fs.readdir(outputDirectory);
    expect(entries.some((entry) => String(entry).includes(".tmp"))).toBe(false);
  });

  it("does not retry temp writes that only inherit existing-path codes", async () => {
    const writeError = new Error("temp write failed");
    const writeFile = vi.fn(
      async (
        filePath: string,
        _contents: string,
        _options: { encoding: "utf8"; flag?: string }
      ) => {
        if (filePath.startsWith("/package/dist-site/index.html.")) {
          throw writeError;
        }
      }
    );
    const fileSystem = {
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      writeFile
    };

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        buildSite({ fs: fileSystem, outputDirectory: "/package/dist-site" })
      ).rejects.toBe(writeError);
    });

    expect(
      writeFile.mock.calls.filter(([filePath]) =>
        filePath.startsWith("/package/dist-site/index.html.")
      )
    ).toHaveLength(1);
    expect(fileSystem.rm).toHaveBeenCalledOnce();
  });
});
