import { describe, expect, it } from "vitest";

import { highlight } from "./highlight.js";

describe("highlight", () => {
  it("wraps language keywords", () => {
    expect(highlight("const x = 1")).toContain('<span class="tok-kw">const</span>');
    expect(highlight("await run()")).toContain('<span class="tok-kw">await</span>');
  });

  it("leaves identifiers that merely contain a keyword untouched", () => {
    const html = highlight("constant");
    expect(html).toBe("constant");
  });

  it("does not treat keywords inside strings as keywords", () => {
    const html = highlight('"const"');
    expect(html).toContain('<span class="tok-str">&quot;const&quot;</span>');
    expect(html).not.toContain("tok-kw");
  });

  it("highlights js line comments and ignores keywords within them", () => {
    const html = highlight("// const here");
    expect(html).toContain('<span class="tok-comment">// const here</span>');
    expect(html).not.toContain("tok-kw");
  });

  it("highlights shell hash comments", () => {
    expect(highlight("# a note")).toContain('<span class="tok-comment"># a note</span>');
  });

  it("highlights numbers and CLI flags", () => {
    expect(highlight("greet --name x")).toContain('<span class="tok-flag">--name</span>');
    expect(highlight("port 8080")).toContain('<span class="tok-num">8080</span>');
  });

  it("does not mistake a minus operator for a flag", () => {
    const html = highlight("a - b");
    expect(html).not.toContain("tok-flag");
  });

  it("escapes HTML so the output is injection-safe", () => {
    const html = highlight("a < b && c > d");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).toContain("&amp;");
    expect(html).not.toContain("a < b");
  });

  it("treats a template literal as a single string token", () => {
    const html = highlight("`Hello, ${name}`");
    expect(html.match(/tok-str/g)).toHaveLength(1);
  });
});
