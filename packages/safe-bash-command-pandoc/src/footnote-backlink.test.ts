import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";
import {convert} from "./engine.js";

for (const publicCommand of [false, true]) {
  for (const paragraphs of [["First paragraph."], ["First paragraph.", "Second paragraph."]]) {
    it(`keeps the backlink in the final paragraph (${paragraphs.length} paragraphs, public=${publicCommand})`, async () => {
      const markdown = `A sentence with a note.[^n]\n\n[^n]: ${paragraphs.join("\n\n    ")}\n`;
      const bytes = new TextEncoder().encode(markdown);
      let output = "";
      if (publicCommand) {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.md", bytes);
        let errors = "";
        const result = await createPandocCommand().execute({
          command: "pandoc", args: ["-f", "markdown", "-t", "html5", "/input.md"],
          fs, cwd: "/", env: {}, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: {async write(chunk) {output += new TextDecoder().decode(chunk);}},
          stderr: {async write(chunk) {errors += new TextDecoder().decode(chunk);}}
        });
        expect(result.exitCode).toBe(0);
        expect(errors).toBe("");
      } else {
        const result = await convert([{bytes}], {from: "markdown", to: "html5"}, {});
        expect(result.kind).toBe("text");
        if (result.kind === "text") output = result.text;
      }
      expect(output).toContain(`<p>${paragraphs.at(-1)}<a href="#fnref1" class="footnote-back" role="doc-backlink">↩</a></p>`);
      if (paragraphs.length > 1) expect(output).toContain("<p>First paragraph.</p>");
      expect(output.split('class="footnote-back"')).toHaveLength(2);
    });
  }
}
