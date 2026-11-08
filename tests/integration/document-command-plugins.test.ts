import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import * as pandoc from "safe-bash-command-pandoc";
import * as xmllint from "safe-bash-command-xmllint";
import * as xz from "safe-bash-command-xz";
import * as fmt from "safe-bash-command-fmt";
import * as imagemagick from "safe-bash-command-imagemagick";
import { pdfinfoCommands } from "safe-bash-command-pdfinfo";
import { pdfimagesCommands } from "safe-bash-command-pdfimages";
import { pdftoppmCommands } from "safe-bash-command-pdftoppm";
import { sipsCommands } from "safe-bash-command-sips";
import { mmdcCommands } from "safe-bash-command-mmdc";

it.each([false, true])("registers document and image plugins together (reversed: %s)", async reverse => {
  const plugins = [pdfinfoCommands(), pdfimagesCommands(), pdftoppmCommands(),
    sipsCommands(), imagemagick.imagemagickCommands(), mmdcCommands(),
    pandoc.pandocCommands(), xmllint.xmllintCommands(), xz.xzCommands(), fmt.fmtCommands()];
  const shell = new Shell({ fs: new MemoryFileSystem() });
  try {
    for (const plugin of reverse ? plugins.reverse() : plugins) shell.use(plugin);
    expect((await shell.exec("true")).exitCode).toBe(0);
  } finally { await shell.dispose(); }
});

it("exports the standard singular and plural factories", () => {
  for (const [single, plural, name] of [
    [pandoc.createPandocCommand, pandoc.createPandocCommands, "pandoc"],
    [xmllint.createXmllintCommand, xmllint.createXmllintCommands, "xmllint"],
    [xz.createXzCommand, xz.createXzCommands, "xz"],
    [fmt.createFmtCommand, fmt.createFmtCommands, "fmt"],
    [imagemagick.createImagemagickCommand, imagemagick.createImagemagickCommands, "magick"]
  ] as const) {
    expect(single().name).toBe(name);
    expect(plural().map(command => command.name)).toContain(name);
  }
});

it("converts inferred Markdown tables and projects generated HTML heading attributes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.md", new TextEncoder().encode("# Hello\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"));
  const shell = new Shell({ fs }).use(pandoc.pandocCommands());
  try {
    expect((await shell.exec("pandoc /input.md -t html -o /output.html")).exitCode).toBe(0);
    const html = new TextDecoder().decode(await fs.readFile("/output.html"));
    expect(html).toContain('<h1 id="hello">');
    expect(html).toContain("<table>");
    expect((await shell.exec("pandoc -f markdown /input.md -o /output.docx")).exitCode).toBe(0);
    const markdown = await shell.exec("pandoc /output.docx -t markdown");
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    expect(markdown.stdout).toContain("Hello");
    await fs.writeFile("/heading.md", new TextEncoder().encode("# Hello\n"));
    expect((await shell.exec("pandoc /heading.md -t html -o /heading.html")).exitCode).toBe(0);
    await fs.writeFile("/attributes.html", new TextEncoder().encode('<h1 id="title" class="title">Hello</h1><p class="body">world</p>'));
    for (const format of ["gfm", "commonmark"]) {
      const result = await shell.exec(`pandoc /heading.html -t ${format}`);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("# Hello");
      const attributes = await shell.exec(`pandoc /attributes.html -t ${format}`);
      expect(attributes.exitCode, attributes.stderr).toBe(0);
      expect(attributes.stdout).toContain("world");
    }
  } finally { await shell.dispose(); }
});
