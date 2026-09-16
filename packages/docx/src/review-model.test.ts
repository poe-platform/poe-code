import { expect, it } from "vitest";
import { Volume } from "memfs";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import {
  Comment,
  Comments,
  Hyperlink,
  RenderedPageBreak,
  bindCommentRange,
  markCommentRange
} from "./review-model.js";
import type { ModelStore, ModelRef } from "./model-store.js";
import { w } from "../tests/fixtures/text.js";

function admitted(markup: string) {
  const volume = Volume.fromJSON({ "/part": markup });
  const nodes = new Map<number, readonly number[]>();
  let next = 0;
  let current = new DocumentXmlEditor(new TextEncoder().encode(markup));
  const xml = () => current;
  const node = (ref: ModelRef) => {
    let result = xml().root;
    for (const i of nodes.get(ref.id)!) result = result.children[i]!;
    return result;
  };
  const ref = (_part: string, target: ReturnType<typeof node>) => {
    const editor = xml();
    let path: number[] | undefined;
    const visit = (n: typeof target, p: number[]) => {
      if (n === target) path = p;
      n.children.forEach((c, i) => visit(c, [...p, i]));
    };
    visit(editor.root, []);
    const id = next++;
    nodes.set(id, path!);
    return { part: "/part", id };
  };
  const store = {
    context: { timestamp: new Date("2025-02-03T04:05:06Z") },
    xml: (_part: string) => xml(),
    node,
    ref,
    change: (_part: string, action: (editor: DocumentXmlEditor) => void) => {
      const editor = xml();
      action(editor);
      volume.writeFileSync("/part", editor.serialize());
      current = new DocumentXmlEditor(editor.serialize());
    },
    part: () => ({
      rels: {
        at: () => ({
          is_external: true,
          reltype: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
          target_ref: "https://example.test/raw#stored"
        })
      }
    }),
    run: (r: ModelRef) => ({
      get text() {
        return node(r)
          .children.filter((n) => n.localName === "t")
          .map((n) =>
            n.content
              .filter((c) => c.kind === "text")
              .map((c) => c.text)
              .join("")
          )
          .join("");
      }
    }),
    blocks: (r: ModelRef) =>
      node(r)
        .children.filter((n) => ["p", "tbl"].includes(n.localName))
        .map((n) => ({
          kind: n.localName,
          text: n.children
            .map((c) =>
              c.children
                .filter((t) => t.localName === "t")
                .map((t) =>
                  t.content
                    .filter((c) => c.kind === "text")
                    .map((c) => c.text)
                    .join("")
                )
                .join("")
            )
            .join("")
        })),
    paragraph: (r: ModelRef) => ({
      kind: node(r).localName,
      get text() {
        return node(r)
          .children.map((c) =>
            c.children
              .filter((t) => t.localName === "t")
              .map((t) =>
                t.content
                  .filter((c) => c.kind === "text")
                  .map((c) => c.text)
                  .join("")
              )
              .join("")
          )
          .join("");
      }
    }),
    table: (r: ModelRef) => ({ kind: node(r).localName }),
    detachedParagraph: (markup: string) => {
      const v = Volume.fromJSON({ "/fragment": markup });
      return {
        get text() {
          return v.readFileSync("/fragment", "utf8") as string;
        },
        set text(s: string) {
          v.writeFileSync("/fragment", s);
        }
      };
    }
  } as unknown as ModelStore;
  return {
    store,
    root: ref("/part", xml().root),
    ref: (path: number[]) => {
      const id = next++;
      nodes.set(id, path);
      return { part: "/part", id };
    },
    source: () => volume.readFileSync("/part", "utf8")
  };
}
it("keeps comment metadata exact, readonly time copies and absent lookup null", () => {
  const m = admitted(
    `<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Mira" w:date="2025-02-03T04:05:06Z"><w:p/></w:comment></w:comments>`
  );
  const comments = new Comments(m.store, m.root),
    c = comments.get(7)!;
  expect(c).toBeInstanceOf(Comment);
  expect(comments.get(8)).toBeNull();
  expect(comments.length).toBe(1);
  expect([...comments]).toHaveLength(1);
  expect(c.comment_id).toBe(7);
  expect(c.timestamp).toEqual(new Date("2025-02-03T04:05:06Z"));
  c.timestamp!.setFullYear(1999);
  expect(c.timestamp!.getUTCFullYear()).toBe(2025);
  c.initials = null;
  c.author = "Nia";
  expect(c.initials).toBeNull();
  expect(c.author).toBe("Nia");
  expect("id" in c).toBe(false);
  expect("date" in c).toBe(false);
});
it("preserves rich comment block order and omits container run aliases", () => {
  const m = admitted(
      `<w:comment xmlns:w="${w}" w:id="0"><w:p><w:r><w:t>first</w:t></w:r></w:p><w:tbl/><w:p><w:r><w:t>last</w:t></w:r></w:p></w:comment>`
    ),
    c = new Comment(m.store, m.root);
  expect([...c.iter_inner_content()].map((b) => (b as unknown as { kind: string }).kind)).toEqual([
    "p",
    "tbl",
    "p"
  ]);
  expect(c.paragraphs).toHaveLength(2);
  expect(c.tables).toHaveLength(1);
  expect(c.text).toBe("first\nlast");
  expect("add_run" in c).toBe(false);
});
it("traverses link runs without normalizing target data or exposing cached breaks as text", () => {
  const m = admitted(
      `<w:hyperlink xmlns:w="${w}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1" w:anchor="separate"><w:r><w:t>A</w:t><w:lastRenderedPageBreak/></w:r><w:r><w:t>B</w:t></w:r></w:hyperlink>`
    ),
    link = new Hyperlink(m.store, m.root);
  expect(link.address).toBe("https://example.test/raw#stored");
  expect(link.url).toBe("https://example.test/raw#stored#separate");
  expect(link.text).toBe("AB");
  expect(link.contains_page_break).toBe(true);
  const n = admitted(`<w:hyperlink xmlns:w="${w}" w:anchor="inside"/>`);
  expect(new Hyperlink(n.store, n.root).url).toBe("");
});
it("returns detached cached-break fragments and keeps an entire hyperlink preceding", () => {
  const m = admitted(
    `<w:p xmlns:w="${w}"><w:r><w:t>before</w:t></w:r><w:hyperlink><w:r><w:t>label</w:t><w:lastRenderedPageBreak/><w:t>end</w:t></w:r></w:hyperlink><w:r><w:t>after</w:t></w:r></w:p>`
  );
  const before = m.source(),
    b = new RenderedPageBreak(m.store, m.ref([1, 0, 1]), m.root);
  expect(b.preceding_paragraph_fragment!.text).toContain("label");
  expect(b.preceding_paragraph_fragment!.text).toContain("end");
  expect(b.following_paragraph_fragment!.text).toContain("after");
  b.preceding_paragraph_fragment!.text = "changed";
  expect(m.source()).toBe(before);
});
it("creates comment bodies with explicit context time and validates null before edits", () => {
  const m = admitted(`<w:comments xmlns:w="${w}"/>`),
    comments = new Comments(m.store, m.root);
  const c = comments.add_comment("new\tline\nend", "Lena", null);
  expect(c.comment_id).toBe(0);
  expect(c.timestamp?.toISOString()).toBe("2025-02-03T04:05:06.000Z");
  expect(c.author).toBe("Lena");
  expect(c.initials).toBeNull();
  const source = m.source();
  expect(() => comments.add_comment(null as unknown as string)).toThrow();
  expect(m.source()).toBe(source);
});
it("splits a cached break in a run and returns null for paragraph boundaries", () => {
  const m = admitted(
      `<w:p xmlns:w="${w}"><w:r><w:t>left</w:t><w:lastRenderedPageBreak/><w:t>right</w:t></w:r></w:p>`
    ),
    b = new RenderedPageBreak(m.store, m.ref([0, 1]), m.root);
  expect(b.preceding_paragraph_fragment!.text).toContain("left");
  expect(b.preceding_paragraph_fragment!.text).not.toContain("right");
  expect(b.following_paragraph_fragment!.text).toContain("right");
  expect(b.following_paragraph_fragment!.text).not.toContain("left");
  const n = admitted(
    `<w:p xmlns:w="${w}"><w:r><w:lastRenderedPageBreak/><w:t>right</w:t></w:r></w:p>`
  );
  expect(
    new RenderedPageBreak(n.store, n.ref([0, 0]), n.root).preceding_paragraph_fragment
  ).toBeNull();
});
it("rejects invalid timestamp lexical data without guessing a timezone", () => {
  const m = admitted(`<w:comment xmlns:w="${w}" w:id="0" w:date="2025-02-03"/>`);
  expect(() => new Comment(m.store, m.root).timestamp).toThrow();
});
it("retains run formatting on both sides of a cached break", () => {
  const m = admitted(
      `<w:p xmlns:w="${w}"><w:r><w:rPr><w:b/></w:rPr><w:t>left</w:t><w:lastRenderedPageBreak/><w:t>right</w:t></w:r></w:p>`
    ),
    b = new RenderedPageBreak(m.store, m.ref([0, 2]), m.root);
  expect(b.following_paragraph_fragment!.text).toContain("w:b");
});
it("rejects header, nested-comment and reversed range owners before creating comments", () => {
  for (const owner of ["hdr", "comment"]) {
    const m = admitted(
        `<w:${owner} xmlns:w="${w}"><w:p><w:r><w:t>word</w:t></w:r></w:p></w:${owner}>`
      ),
      source = m.source();
    const run = { store: m.store, ref: m.ref([0, 0]) } as unknown as Parameters<
      typeof bindCommentRange
    >[1];
    expect(() => bindCommentRange(m.store, run, "review")).toThrow(UnsupportedEditError);
    expect(m.source()).toBe(source);
  }
  const m = admitted(
      `<w:body xmlns:w="${w}"><w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p></w:body>`
    ),
    source = m.source();
  const runs = [
    { store: m.store, ref: m.ref([0, 1]) },
    { store: m.store, ref: m.ref([0, 0]) }
  ] as unknown as Parameters<typeof bindCommentRange>[1];
  expect(() => bindCommentRange(m.store, runs, "review")).toThrow(UnsupportedEditError);
  expect(m.source()).toBe(source);
});
it("anchors all intervening paragraph runs and publishes rich comments in memory", async () => {
  const { Document } = await import("./document-model.js"),
    { textFixture, textContext } = await import("../tests/fixtures/text.js"),
    { Inches } = await import("./formatting-values.js");
  const bytes = await textFixture(
    `<w:p><w:r><w:t>one</w:t></w:r><w:r><w:t>two</w:t></w:r></w:p><w:p><w:r><w:t>three</w:t></w:r></w:p>`
  );
  const doc = await Document(bytes, {
    ...textContext,
    timestamp: new Date("2025-02-03T04:05:06Z")
  });
  const c = doc.store.transaction(() =>
    bindCommentRange(
      doc.store,
      [doc.paragraphs[0]!.runs[0]!, doc.paragraphs[1]!.runs[0]!],
      "review",
      "Ada"
    )
  );
  c.add_table(1, 1, Inches(2));
  c.add_paragraph("trailer");
  expect([...c.iter_inner_content()].map((b) => doc.store.node(b.ref).localName)).toEqual([
    "p",
    "tbl",
    "p"
  ]);
  const chunks: Uint8Array[] = [];
  await doc.save({
    async write(bytes) {
      chunks.push(bytes.slice());
    }
  });
  const size = chunks.reduce((sum, c) => sum + c.length, 0),
    combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  const volume = Volume.fromJSON({ "/published": Buffer.from(combined) }),
    reopened = await Document(
      new Uint8Array(volume.readFileSync("/published") as Buffer),
      textContext
    );
  expect(reopened.comments.get(c.comment_id)?.text).toBe("review\ntrailer");
  const { inspectDocumentComments } = await import("./comments.js"),
    data = await inspectDocumentComments(
      combined,
      { operation: "comments.list", options: {} },
      textContext
    );
  expect(data.items[0]?.issues).toEqual([]);
  expect(data.items[0]?.range).not.toBeNull();
});
it("rejects extracting a later cached break until its preceding fragment is selected", () => {
  const m = admitted(
      `<w:p xmlns:w="${w}"><w:r><w:t>a</w:t><w:lastRenderedPageBreak/><w:t>b</w:t><w:lastRenderedPageBreak/><w:t>c</w:t></w:r></w:p>`
    ),
    b = new RenderedPageBreak(m.store, m.ref([0, 3]), m.root);
  expect(() => b.preceding_paragraph_fragment).toThrow(UnsupportedEditError);
  expect(() => b.following_paragraph_fragment).toThrow(UnsupportedEditError);
});
it("removes the extracted cached marker from the detached whole hyperlink", () => {
  const m = admitted(
      `<w:p xmlns:w="${w}"><w:hyperlink><w:r><w:t>a</w:t><w:lastRenderedPageBreak/><w:t>b</w:t></w:r></w:hyperlink></w:p>`
    ),
    b = new RenderedPageBreak(m.store, m.ref([0, 0, 1]), m.root);
  expect(b.preceding_paragraph_fragment!.text).not.toContain("lastRenderedPageBreak");
});
it("ignores id attributes outside the relationship namespace", () => {
  const m = admitted(`<w:hyperlink xmlns:w="${w}" xmlns:x="urn:unowned" x:id="rId1"/>`);
  expect(new Hyperlink(m.store, m.root).address).toBe("");
});
it("rejects inherited part access after owner detachment", async () => {
  const { Document } = await import("./document-model.js"),
    { textFixture, textContext } = await import("../tests/fixtures/text.js");
  const doc = await Document(
    await textFixture(
      `<w:p><w:hyperlink><w:r><w:t>label</w:t><w:lastRenderedPageBreak/></w:r></w:hyperlink></w:p>`
    ),
    textContext
  );
  const link = doc.paragraphs[0]!.hyperlinks[0]!,
    cached = doc.paragraphs[0]!.rendered_page_breaks[0]!;
  doc.paragraphs[0]!.element.children[0]!.remove();
  expect(() => link.part).toThrow();
  expect(() => cached.part).toThrow();
});
it("rejects field and comment marker children inside the final endpoint run", () => {
  for (const child of ['<w:fldChar w:fldCharType="begin"/>', '<w:commentReference w:id="3"/>']) {
    const m = admitted(
        `<w:body xmlns:w="${w}"><w:p><w:r><w:t>word</w:t>${child}</w:r></w:p></w:body>`
      ),
      source = m.source(),
      run = { store: m.store, ref: m.ref([0, 0]) } as unknown as Parameters<
        typeof bindCommentRange
      >[1];
    expect(() => bindCommentRange(m.store, run, "review")).toThrow(UnsupportedEditError);
    expect(m.source()).toBe(source);
  }
});
it("marks an existing rich comment body without allocating another comment", async () => {
  const { Document } = await import("./document-model.js"),
    { textFixture, textContext } = await import("../tests/fixtures/text.js");
  const doc = await Document(
      await textFixture(`<w:p><w:r><w:t>word</w:t></w:r></w:p>`),
      textContext
    ),
    c = doc.comments.add_comment("existing"),
    run = doc.paragraphs[0]!.runs[0]!;
  doc.store.transaction(() => markCommentRange(doc.store, run, run, c.comment_id));
  expect(doc.comments.length).toBe(1);
  expect(doc.comments.get(c.comment_id)?.text).toBe("existing");
  const source = doc.store.xml(doc.store.mainPart).serialize();
  expect(() => markCommentRange(doc.store, run, run, 99)).toThrow();
  expect(doc.store.xml(doc.store.mainPart).serialize()).toEqual(source);
});
it("keeps opaque rich block positions from shifting visible paragraph text", () => {
  const m = admitted(
    `<w:comment xmlns:w="${w}" xmlns:x="urn:opaque" w:id="0"><x:p/><w:tbl/><w:p><w:r><w:t>visible</w:t></w:r></w:p></w:comment>`
  );
  expect(new Comment(m.store, m.root).text).toBe("visible");
});
