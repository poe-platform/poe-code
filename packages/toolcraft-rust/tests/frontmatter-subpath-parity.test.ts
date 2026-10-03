import assert from "node:assert/strict";
import { it } from "vitest";
import * as own from "@poe-code/frontmatter-rust";

it("Native frontmatter subpath exposes the reference namespace and own identities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/frontmatter"),
    import("toolcraft/frontmatter")
  ]);
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.equal(native[name], own[name], name);
});

it("Native frontmatter subpath retains bodies, UTF-16 positions, callbacks and typed errors", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/frontmatter"),
    import("toolcraft/frontmatter")
  ]);
  for (const ending of ["\n", "\r\n", "\r"]) for (const bom of ["", "\uFEFF"]) {
    const source = bom + ["---", "title: Hello", "items: [one, two]", "title: Last", "---", "# 😀 Body\ud800", "tail"].join(ending);
    assert.deepEqual(native.splitFrontmatterBlock(source), reference.splitFrontmatterBlock(source));
    const parsed = native.parseFrontmatter(source);
    assert.deepEqual(parsed, reference.parseFrontmatter(source));
    assert.equal(native.stringifyFrontmatter(parsed.frontmatter, parsed.body), reference.stringifyFrontmatter(parsed.frontmatter, parsed.body));
    const a = native.parseFrontmatterDocument(source), b = reference.parseFrontmatterDocument(source);
    assert.deepEqual({frontmatter: a.frontmatter, body: a.body, errors: a.errors}, {frontmatter: b.frontmatter, body: b.body, errors: b.errors});
    assert.deepEqual(Object.keys(a.lineCounter), Object.keys(b.lineCounter));
    assert.deepEqual(a.lineCounter.lineStarts, b.lineCounter.lineStarts);
    for (let offset = -1; offset <= source.length + 1; offset += 0.5) assert.deepEqual(a.lineCounter.linePos(offset), b.lineCounter.linePos(offset));
  }
  for (const api of [reference, native]) {
    const failure = new Error("option getter");
    const options = {get uniqueKeys(): boolean {throw failure;}};
    assert.deepEqual(api.parseFrontmatter("Body", options), {frontmatter: {}, body: "Body"});
    assert.throws(() => api.parseFrontmatter("---\na: b\n---", options), error => error instanceof api.FrontmatterParseError && error.message === "Invalid YAML frontmatter: option getter");
    assert.throws(() => api.parseFrontmatterDocument("---\na: b\n---", options), error => error === failure);
    const kind = new api.FrontmatterKindError("Wrong kind", {expected: "skill", found: "task"});
    assert.equal(api.isFrontmatterKindError(kind), true);
    assert.ok(kind instanceof api.FrontmatterParseError);
    assert.equal(kind.expectedKind, "skill");
    assert.equal(kind.foundKind, "task");
  }
});
