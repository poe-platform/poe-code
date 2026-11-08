import {expect, it} from "vitest";
import {Shell} from "../../packages/safe-bash/src/shell/index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {ssconvertCommands, createSsconvertCommand} from "../../packages/safe-bash/src/commands/ssconvert/index.js";
import {csvkitCommands, createCsvkitCommands} from "../../packages/safe-bash/src/commands/csvkit/index.js";
import {pandocCommands} from "../../packages/safe-bash/src/commands/pandoc/index.js";

it.each(["plugin", "factory"])("converts CSV to XLSX and back using default %s bindings", async mode => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("name,score\napple,7\n"));
  const shell = new Shell({fs});
  if (mode === "plugin") shell.use(ssconvertCommands()).use(csvkitCommands());
  else for (const command of [createSsconvertCommand(), ...createCsvkitCommands()]) shell.register(command);
  try {
    const converted = await shell.exec("ssconvert /data.csv /out.xlsx");
    expect(converted.stderr).toBe("");
    expect(converted.exitCode).toBe(0);
    expect((await fs.readFile("/out.xlsx")).length).toBeGreaterThan(100);
    const roundtrip = await shell.exec("in2csv /out.xlsx");
    expect(roundtrip.exitCode, roundtrip.stderr).toBe(0);
    expect(roundtrip.stdout).toBe("name,score\napple,7\n");
    const formatted = await shell.exec("csvlook /data.csv");
    expect(formatted.exitCode, formatted.stderr).toBe(0);
    expect(formatted.stdout).toContain("apple");
  } finally {await shell.dispose();}
});

it("uses Markdown defaults and aliases through the shell", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/document", new TextEncoder().encode("~~removed~~\n\n| Name |\n| --- |\n| Apple |\n"));
  await fs.writeFile("/doc.md", new TextEncoder().encode("# Title\n\n- item\n"));
  const shell = new Shell({fs}).use(pandocCommands());
  try {
    for (const command of ["pandoc /document", "pandoc < /document", "pandoc /doc.md -t html"]) {
      const result = await shell.exec(command);
      expect(result.exitCode, result.stderr).toBe(0);
      if (!command.includes("doc.md")) {
        expect(result.stdout, command).toContain("<del>removed</del>");
        expect(result.stdout).toContain("<table>");
      } else expect(result.stdout).toContain("Title");
    }
    const docx = await shell.exec("pandoc /doc.md -o /out.docx");
    expect(docx.exitCode, docx.stderr).toBe(0);
    for (const alias of ["markdown", "markdown_github", "markdown_strict", "commonmark_x"]) {
      const html = await shell.exec(`pandoc -f ${alias} -t html /doc.md`);
      expect(html.exitCode, html.stderr).toBe(0);
      expect(html.stdout).toContain("Title");
      const markdown = await shell.exec(`pandoc -f docx -t ${alias} /out.docx`);
      expect(markdown.exitCode, markdown.stderr).toBe(0);
      expect(markdown.stdout).toContain("# Title");
      expect(markdown.stdout).toContain("item");
    }
  } finally {await shell.dispose();}
});
