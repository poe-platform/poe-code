import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";

it("admits a live document, preserves retained siblings and invalidates replaced runs", async () => {
  const input = await textFixture(
    `<w:p>${run("Coast")}${run(" survey")}</w:p>${paragraph("Retained")}`
  );
  const document = await api.Document(input, textContext);
  const first = document.paragraphs[0]!;
  const old = first.runs[0]!;
  const second = document.paragraphs[1]!;
  first.add_run(" today").bold = true;
  expect(old.text).toBe("Coast");
  expect(first.text).toBe("Coast survey today");
  first.text = "Revised";
  expect(() => old.text).toThrow(api.StaleHandleError);
  expect(second.text).toBe("Retained");
  const volume = Volume.fromJSON({ "/out": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/out", bytes);
    }
  });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await api.extractDocumentText(bytes, textContext)).text).toBe("Revised\nRetained");
});

it("uses ordered nested model owners and does not admit cross-document assignments", async () => {
  const document = await api.Document(undefined, textContext);
  const table = document.add_table(1, 2);
  table.cell(0, 0).text = "Bay";
  const nested = table.cell(0, 0).add_table(1, 1);
  nested.cell(0, 0).text = "Depth";
  expect([...table.cell(0, 0).iter_inner_content()].map((block) => block.constructor.name)).toEqual(
    ["Paragraph", "Table", "Paragraph"]
  );
  expect(table.cell(0, 1).text).toBe("");
  const other = await api.Document(undefined, textContext);
  expect(() => table.cell(0, 0).merge(other.add_table(1, 1).cell(0, 0))).toThrow();
});

it("keeps table styles in the same live package owner", async () => {
  const document = await api.Document(undefined, textContext);
  const style = document.styles.add_style("Marine grid", api.WD_STYLE_TYPE.TABLE);
  const table = document.add_table(1, 1);
  table.style = style;
  table.style!.font.bold = true;
  expect(style.font.bold).toBe(true);
  const volume = Volume.fromJSON({ "/out": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/out", bytes);
    }
  });
  const reopened = await api.Document(
    new Uint8Array(volume.readFileSync("/out") as Buffer),
    textContext
  );
  expect(reopened.tables[0]!.style!.name).toBe("Marine grid");
  expect(reopened.tables[0]!.style!.font.bold).toBe(true);
});

it("returns owned break fragments through admitted paragraph and hyperlink traversal", async () => {
  const input = await textFixture(
    `<w:p>${run("Before")}<w:hyperlink w:anchor="target"><w:r><w:t>Link</w:t><w:lastRenderedPageBreak/><w:t> label</w:t></w:r></w:hyperlink>${run("After")}</w:p>`
  );
  const document = await api.Document(input, textContext);
  const p = document.paragraphs[0]!;
  expect([...p.iter_inner_content()].map((item) => item.text)).toEqual([
    "Before",
    "Link label",
    "After"
  ]);
  const br = p.rendered_page_breaks[0]!;
  expect(br.preceding_paragraph_fragment!.text).toBe("BeforeLink label");
  expect(br.following_paragraph_fragment!.text).toBe("After");
  br.preceding_paragraph_fragment!.text = "Detached edit";
  expect(p.text).toBe("BeforeLink labelAfter");
});

it("rolls back invalid model graph transactions and retains prior handles", async () => {
  const document = await api.Document(undefined, textContext);
  const p = document.paragraphs[0]!;
  expect(() =>
    document.store.transaction(() => document.store.deletePart(document.store.mainPart))
  ).toThrow();
  expect(p.text).toBe("");
  p.add_run("Still live");
  expect(p.text).toBe("Still live");
});

it("retains inherited paragraph/run equality and source-spelled run style owners", async () => {
  const document = await api.Document(undefined, textContext);
  const p = document.paragraphs[0]!;
  expect(p.equals(document.paragraphs[0])).toBe(true);
  const run = p.add_run("Signal");
  const style = document.styles.add_style("Marine emphasis", api.WD_STYLE_TYPE.CHARACTER);
  run.style = style;
  expect(run.style!.equals(style)).toBe(true);
  expect(run.equals(p.runs[0])).toBe(true);
  const other = await api.Document(undefined, textContext);
  expect(
    () => (run.style = other.styles.add_style("Marine emphasis", api.WD_STYLE_TYPE.CHARACTER))
  ).toThrow();
});

it("marks an existing comment body without creating a second body or losing run identity", async () => {
  const document = await api.Document(undefined, textContext);
  const p = document.paragraphs[0]!;
  const first = p.add_run("First");
  const last = p.add_run(" last");
  const comment = document.comments.add_comment("Review");
  first.mark_comment_range(last, comment.comment_id);
  expect(first.text).toBe("First");
  expect(last.text).toBe(" last");
  expect(document.comments.length).toBe(1);
  const volume = Volume.fromJSON({ "/out": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/out", bytes);
    }
  });
  const read = await api.inspectDocumentComments(
    new Uint8Array(volume.readFileSync("/out") as Buffer),
    { operation: "comments.list", options: {} },
    textContext
  );
  expect(read.items[0]!.range).not.toBeNull();
});
