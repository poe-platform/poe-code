import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";

import { buildSite } from "./build-site.js";

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
    expect(html).toContain("npm install -g acme");
    expect(html).toContain("1.4.0");
    expect(html).toContain('href="https:&#x2F;&#x2F;github.com&#x2F;acme&#x2F;acme"');
    expect(html).not.toMatch(/<link\b[^>]*\bhref=/i);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
    await expect(fs.readFile(path.join(outputDirectory, ".nojekyll"), "utf8")).resolves.toBe("");
  });
});
