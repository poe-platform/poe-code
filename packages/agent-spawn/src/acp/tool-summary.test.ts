import { describe, expect, it } from "vitest";
import { summarizeToolAction } from "./tool-summary.js";

describe("concise dashboard tool actions", () => {
  it.each([
    ["/bin/zsh -lc 'cat src/validation.ts'", "Read src/validation.ts"],
    ["/bin/zsh -lc \"sed -n '97,149p' packages/docx/tests/assertions.ts\"", "Read packages/docx/tests/assertions.ts"],
    ["head -75 packages/docx/src/run-format-command.test.ts", "Read packages/docx/src/run-format-command.test.ts"],
    ["rg -n -C 4 'includes(' packages/docx/src/validation.ts", "Search includes( in packages/docx/src/validation.ts"],
    ["rg --files src", "List files in src"],
    ["npm test --workspace=docx", "Run npm test --workspace=docx"],
    ["python3 - <<'PY'\nfrom pathlib import Path\nprint('work')\nPY", "Run python3 script"],
    ["cat one.ts; cat two.ts", "Read one.ts, two.ts"],
    ["cat > docs/result.md <<'EOF'\nresult\nEOF", "Run cat script"]
  ])("summarizes %s without shell wrapper noise", (title, label) => {
    expect(summarizeToolAction({ kind: "exec", title })).toEqual({ label, detail: title });
  });

  it("uses complete structured input when the adapter title has been shortened", () => {
    const command = "/bin/zsh -lc 'cat packages/very-long-workspace-name/src/important-document-validation.ts'";
    expect(summarizeToolAction({ kind: "exec", title: command.slice(0, 70) + "...", input: { command } }).label)
      .toBe("Read packages/very-long-workspace-name/src/important-document-validation.ts");
  });

  it("keeps file and search tools readable without provider-specific branches", () => {
    expect(summarizeToolAction({ kind: "edit", title: "src/settings.ts" }).label).toBe("Edit src/settings.ts");
    expect(summarizeToolAction({ kind: "search", title: "render", input: { pattern: "render", path: "src" } }).label)
      .toBe("Search render in src");
    expect(summarizeToolAction({ kind: "other", title: "github.get_pull_request" }).label)
      .toBe("Use github.get_pull_request");
  });

  it("does not mislabel a redirected command as a file read", () => {
    expect(summarizeToolAction({ kind: "exec", title: "cat input.md > output.md" }).label).toBe("Run cat input.md > output.md");
  });

  it("bounds labels and sanitizes terminal controls while retaining details", () => {
    const title = "\u001b[31m" + "very long command ".repeat(1000) + "\u001b[0m";
    const summary = summarizeToolAction({ kind: "other", title });
    expect(summary.label.length).toBeLessThanOrEqual(100);
    expect(summary.label).not.toContain("\u001b");
    expect(summary.detail).toBe(title);
  });

  it.each([
    ["sed -i '' 's/old/new/g' src/settings.ts", "Edit src/settings.ts"],
    ["sed -i.bak 's/old/new/g' src/settings.ts", "Edit src/settings.ts"],
    ["sed -ni '1p' src/settings.ts", "Edit src/settings.ts"],
    ["sed -Eni.bak '1p' src/settings.ts", "Edit src/settings.ts"],
    ["sed -ne'1p' src/settings.ts", "Read src/settings.ts"],
    ["sed -fscript.sed src/settings.ts", "Read src/settings.ts"],
    ["sed -n -e '1,5p' -e '10p' src/settings.ts", "Read src/settings.ts"],
    ["rg -n 'serialize|xml' packages/docx/src/xml-element-view.ts | head -75", "Search serialize|xml in packages/docx/src/xml-element-view.ts"],
    ["rg --files src | sort | head -40", "List files in src"],
    ["git grep TODO src", "Search TODO in src"],
    ["git ls-files src", "List files in src"],
    ["npm test --workspace=docx > out/tests.log 2>&1", "Run npm test --workspace=docx"],
    ["rg --glob '*.ts' --context=4 -- 'readFile' src", "Search readFile in src"],
    ["head -n 40 -- '-notes.md'", "Read -notes.md"]
  ])("presents common shell actions accurately: %s", (title, label) => {
    expect(summarizeToolAction({ kind: "exec", title })).toEqual({ label, detail: title });
  });

  it.each(["sort -oout/files.txt", "sort -roout/files.txt", "sort --output=out/files.txt"])(
    "retains commands that write sorted output: %s", (sort) => {
      const title = `rg --files src | ${sort}`;
      expect(summarizeToolAction({ kind: "exec", title }).label).toBe(`Run ${title}`);
    }
  );
});
