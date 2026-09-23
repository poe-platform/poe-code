import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { createDocxInspectionCommandEngine } from "./index.js";
import { getDocxDiscovery, type DocxCapabilitiesData, type DocxHelpData } from "./discovery.js";
import { textContext } from "../tests/fixtures/text.js";

for (const route of ["sdk", "cli"] as const) for (const surface of ["help", "capabilities"] as const)
it(`describes ordinary footnote/endnote comment anchors through ${route} ${surface}`, async () => {
  let data: DocxHelpData | DocxCapabilitiesData;
  if (route === "sdk") {
    data = getDocxDiscovery({ operation: surface, inputs: [], options: surface === "help" ? { operation: "comments.add" } : {} })!.data as typeof data;
  } else {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(surface === "help" ? "docx help comments add --json" : "docx capabilities --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      data = JSON.parse(result.stdout).data;
    } finally { await shell.dispose(); }
  }
  const description = surface === "help" ? (data as DocxHelpData).paths[0]!.description : (data as DocxCapabilitiesData).features.find(feature => feature.id === "F25")!.subsets.find(subset => subset.name === "classic-comments")!.reason;
  expect(description).toContain("footnote");
  expect(description).toContain("endnote");
  expect(description).toContain("header/footer");
  expect(description).toContain("run-boundary");
});
