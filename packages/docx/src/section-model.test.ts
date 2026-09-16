import { expect, it } from "vitest";
import { Volume } from "memfs";
import { _Header, _Footer } from "./section-model.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { Document } from "./document-model.js";
import {
  Inches,
  Twips,
  WD_ORIENT,
  WD_SECTION_START,
  WD_STYLE_TYPE,
  WD_HEADER_FOOTER_INDEX
} from "./formatting-values.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";

const hasStyles = (document: Awaited<ReturnType<typeof Document>>) =>
  [...document.part.rels.values()].some((edge) => edge.reltype.endsWith("/styles"));
const boundary = `<w:p><w:pPr><w:sectPr/></w:pPr>${run("Boundary")}</w:p>`;
it("iterates section-owned blocks and retains zero-based collection protocols", async () => {
  const bytes = await textFixture(
    paragraph("First") + boundary + paragraph("Last") + "<w:sectPr/>"
  );
  const memory = Volume.fromJSON({ "/input": Buffer.from(bytes) });
  const document = await Document(
    new Uint8Array(memory.readFileSync("/input") as Buffer),
    textContext
  );
  const sections = document.sections;
  expect(sections.length).toBe(2);
  expect(sections.at(-1).equals(sections.at(1))).toBe(true);
  expect(sections.slice().length).toBe(2);
  expect(sections.count(sections.at(0))).toBe(1);
  expect(sections.index(sections.at(1))).toBe(1);
  expect(sections.includes(sections.at(0))).toBe(true);
  expect(sections[0]!.equals(sections.at(0))).toBe(true);
  expect([...sections.reversed()][0]!.equals(sections.at(-1))).toBe(true);
  expect(sections.slice(-1)[0]!.equals(sections.at(-1))).toBe(true);
  expect(() => sections.at(0.5)).toThrow(TypeError);
  expect(() => sections.index(null)).toThrow(RangeError);
  expect(sections.index(sections.at(1), 1, 2)).toBe(1);
  expect(sections.index(sections.at(1), -1)).toBe(1);
  expect(() => sections.index(sections.at(0), 1)).toThrow(RangeError);
  expect(() => sections.index(sections.at(1), 0, 1)).toThrow(RangeError);
  expect(
    [...sections.at(0).iter_inner_content()].map((block) => ("text" in block ? block.text : ""))
  ).toEqual(["First", "Boundary"]);
  expect(
    [...sections.at(1).iter_inner_content()].map((block) => ("text" in block ? block.text : ""))
  ).toEqual(["Last"]);
  expect(() => sections.at(2)).toThrow(RangeError);
  expect(() => sections.at(-3)).toThrow(RangeError);
});
it("models nullable lengths, enums and first-page policy independently of utility geometry admission", async () => {
  const document = await Document(await textFixture("<w:sectPr/>"), textContext);
  const section = document.sections.at(0);
  expect(section.page_width).toBeNull();
  section.page_width = Inches(8);
  section.left_margin = Inches(1);
  expect(section.page_width?.inches).toBe(8);
  expect(section.left_margin?.inches).toBe(1);
  section.left_margin = null;
  expect(section.left_margin).toBeNull();
  section.orientation = WD_ORIENT.LANDSCAPE;
  section.start_type = WD_SECTION_START.CONTINUOUS;
  section.different_first_page_header_footer = true;
  expect(section.orientation).toBe(WD_ORIENT.LANDSCAPE);
  expect(section.start_type).toBe(WD_SECTION_START.CONTINUOUS);
  expect(section.different_first_page_header_footer).toBe(true);
});
it.each([
  "header",
  "first_page_header",
  "even_page_header",
  "footer",
  "first_page_footer",
  "even_page_footer"
] as const)(
  "resolves creating %s getters through the preceding section and isolates explicit unlinking",
  async (key) => {
    const document = await Document(await textFixture(boundary + "<w:sectPr/>"), textContext);
    const first = document.sections.at(0)[key],
      last = document.sections.at(1)[key];
    expect(first.is_linked_to_previous).toBe(true);
    first.is_linked_to_previous = true;
    expect(first.is_linked_to_previous).toBe(true);
    expect(() => Reflect.set(first, "is_linked_to_previous", 1)).toThrow(TypeError);
    expect(last.is_linked_to_previous).toBe(true);
    expect(last.paragraphs).toHaveLength(1);
    expect(first.is_linked_to_previous).toBe(false);
    last.add_paragraph("Shared coast");
    expect(first.paragraphs.at(-1)?.text).toBe("Shared coast");
    last.is_linked_to_previous = false;
    expect(last.paragraphs).toHaveLength(1);
    expect(first.paragraphs.at(-1)?.text).toBe("Shared coast");
    const detached = last.add_paragraph("Local station");
    last.is_linked_to_previous = true;
    expect(() => detached.text).toThrow(RangeError);
    expect(last.paragraphs.at(-1)?.text).toBe("Shared coast");
  }
);
it.each(["header", "footer"] as const)(
  "traverses rich %s blocks in order with inherited bounded element/part views",
  async (key) => {
    const document = await Document(await textFixture("<w:sectPr/>"), textContext);
    const header = document.sections.at(0)[key];
    const intro = header.add_paragraph("Channel report");
    const table = header.add_table(1, 1, Inches(4));
    table.cell(0, 0).add_paragraph("Nested station");
    header.add_paragraph("Closing note");
    expect(header.tables).toHaveLength(1);
    expect(header.paragraphs.map((p) => p.text)).toEqual(["", "Channel report", "Closing note"]);
    expect([...header.iter_inner_content()].map((block) => block.element.tag.localName)).toEqual([
      "p",
      "p",
      "tbl",
      "p"
    ]);
    expect(
      [...table.cell(0, 0).iter_inner_content()].map((block) => ("text" in block ? block.text : ""))
    ).toEqual(["", "Nested station"]);
    expect(intro.part).toBe(header.part);
    expect(header.element.tag.localName).toBe(key === "header" ? "hdr" : "ftr");
  }
);

it("covers every nullable section distance and every retained start/orientation enum", async () => {
  const document = await Document(await textFixture("<w:sectPr/>"), textContext);
  const section = document.sections.at(0);
  for (const key of [
    "page_width",
    "page_height",
    "top_margin",
    "bottom_margin",
    "left_margin",
    "right_margin",
    "gutter",
    "header_distance",
    "footer_distance"
  ] as const) {
    expect(section[key]).toBeNull();
    section[key] = Inches(1.25);
    expect(section[key]?.inches).toBe(1.25);
    section[key] = null;
    expect(section[key]).toBeNull();
  }
  for (const value of Object.values(WD_SECTION_START)) {
    section.start_type = value;
    expect(section.start_type).toBe(value);
  }
  for (const value of Object.values(WD_ORIENT)) {
    section.orientation = value;
    expect(section.orientation).toBe(value);
  }
  section.start_type = null;
  section.orientation = null;
  section.different_first_page_header_footer = false;
  expect(section.start_type).toBe(WD_SECTION_START.NEW_PAGE);
  expect(section.orientation).toBe(WD_ORIENT.PORTRAIT);
  expect(section.different_first_page_header_footer).toBe(false);
  expect(section.element.tag.localName).toBe("sectPr");
  expect(section.part).toBe(document.part);
  section.left_margin = Twips(0);
  section.top_margin = Twips(-275);
  section.bottom_margin = Twips(-375);
  expect(section.left_margin?.twips).toBe(0);
  expect(section.top_margin?.twips).toBe(-275);
  expect(section.bottom_margin?.twips).toBe(-375);
  expect(() => Reflect.set(section, "page_width", "invalid")).toThrow(TypeError);
  expect(() => Reflect.set(section, "orientation", WD_STYLE_TYPE.PARAGRAPH)).toThrow(TypeError);
  expect(() => Reflect.set(section, "different_first_page_header_footer", null)).toThrow(TypeError);
});
it("limits throwing section index lookup to the explicit start and stop", async () => {
  const document = await Document(await textFixture(boundary + "<w:sectPr/>"), textContext);
  const sections = document.sections;
  expect(() => sections.index(sections.at(0), 1)).toThrow(RangeError);
  expect(() => sections.index(sections.at(1), 0, 1)).toThrow(RangeError);
});

it.each(["header", "footer"] as const)(
  "accepts %s paragraph style names, owned style objects and null defaults",
  async (key) => {
    const document = await Document(await textFixture("<w:sectPr/>"), textContext);
    const container = document.sections.at(0)[key];
    const style = document.styles.add_style("Channel marker", WD_STYLE_TYPE.PARAGRAPH);
    const named = container.add_paragraph("Named station", style.name);
    const owned = container.add_paragraph("Owned station", style);
    const absent = container.add_paragraph("Default station", null);
    expect(named.style?.equals(style)).toBe(true);
    expect(owned.style?.equals(style)).toBe(true);
    expect(absent.text).toBe("Default station");
  }
);
it("retains setter-created geometry containers and removes default section-start storage", async () => {
  const document = await Document(await textFixture("<w:sectPr/>"), textContext);
  const section = document.sections.at(0);
  section.page_width = null;
  section.left_margin = null;
  section.orientation = WD_ORIENT.PORTRAIT;
  expect(section.element.children.map((child) => child.tag.localName)).toEqual(["pgSz", "pgMar"]);
  section.start_type = WD_SECTION_START.CONTINUOUS;
  section.start_type = WD_SECTION_START.NEW_PAGE;
  expect(section.element.children.some((child) => child.tag.localName === "type")).toBe(false);
  section.start_type = WD_SECTION_START.ODD_PAGE;
  section.start_type = null;
  expect(section.element.children.some((child) => child.tag.localName === "type")).toBe(false);
});

it("reads each stored first-page boolean form and explicit empty section properties", async () => {
  const flags = [
    "",
    "<w:titlePg/>",
    '<w:titlePg w:val="0"/>',
    '<w:titlePg w:val="1"/>',
    '<w:titlePg w:val="true"/>',
    '<w:titlePg w:val="off"/>'
  ];
  const body = flags
    .map((flag, index) =>
      index < flags.length - 1
        ? `<w:p><w:pPr><w:sectPr><w:type/><w:pgSz/>${flag}</w:sectPr></w:pPr></w:p>`
        : `<w:sectPr><w:type/><w:pgSz/>${flag}</w:sectPr>`
    )
    .join("");
  const document = await Document(await textFixture(body), textContext);
  expect(
    [...document.sections].map((section) => section.different_first_page_header_footer)
  ).toEqual([false, true, false, true, true, false]);
  for (const section of document.sections) {
    expect(section.start_type).toBe(WD_SECTION_START.NEW_PAGE);
    expect(section.orientation).toBe(WD_ORIENT.PORTRAIT);
    expect(section.page_width).toBeNull();
    section.different_first_page_header_footer = !section.different_first_page_header_footer;
  }
  expect(
    [...document.sections].map((section) => section.different_first_page_header_footer)
  ).toEqual([true, false, true, false, false, true]);
});

it("binds public header and footer constructors to all retained story index enums", async () => {
  const document = await Document(await textFixture("<w:sectPr/>"), textContext);
  const section = document.sections.at(0);
  for (const index of Object.values(WD_HEADER_FOOTER_INDEX)) {
    const header = new _Header(section, index),
      footer = new _Footer(section, index);
    header.add_paragraph(`Header ${index.name}`);
    footer.add_paragraph(`Footer ${index.name}`);
    const h =
      index.name === "PRIMARY"
        ? section.header
        : index.name === "FIRST_PAGE"
          ? section.first_page_header
          : section.even_page_header;
    const f =
      index.name === "PRIMARY"
        ? section.footer
        : index.name === "FIRST_PAGE"
          ? section.first_page_footer
          : section.even_page_footer;
    expect(h.paragraphs.at(-1)?.text).toBe(`Header ${index.name}`);
    expect(f.paragraphs.at(-1)?.text).toBe(`Footer ${index.name}`);
  }
});
it("keeps separately retained identical paragraph siblings bound during replacement", async () => {
  const document = await Document(
    await textFixture(paragraph("Same signal") + paragraph("Same signal") + "<w:sectPr/>"),
    textContext
  );
  const first = document.paragraphs[0]!,
    second = document.paragraphs[1]!;
  first.text = "Changed signal";
  expect(first.text).toBe("Changed signal");
  expect(second.text).toBe("Same signal");
});
it("does not materialize missing styles for an unstyled run append", async () => {
  const document = await Document(
    await textFixture(paragraph("Signal") + "<w:sectPr/>"),
    textContext
  );
  expect(hasStyles(document)).toBe(false);
  document.paragraphs[0]!.add_run(" observed");
  expect(hasStyles(document)).toBe(false);
});
it("restores lazy style ownership after a failed transaction creates the missing definition", async () => {
  const document = await Document(
    await textFixture(paragraph("Signal") + "<w:sectPr/>"),
    textContext
  );
  expect(() =>
    document.store.transaction(() => {
      document.styles.add_style("Transient channel", WD_STYLE_TYPE.PARAGRAPH);
      throw new Error("Aborted original operation");
    })
  ).toThrow("Aborted original operation");
  expect(hasStyles(document)).toBe(false);
  expect(() =>
    document.styles.add_style("Retained channel", WD_STYLE_TYPE.PARAGRAPH)
  ).not.toThrow();
});
it("materializes the original default paragraph style when a missing-style getter requires it", async () => {
  const document = await Document(
    await textFixture(paragraph("Signal") + "<w:sectPr/>"),
    textContext
  );
  expect(hasStyles(document)).toBe(false);
  expect(document.paragraphs[0]!.style?.name).toBe("Normal");
  expect(hasStyles(document)).toBe(true);
});
it("restores retained style tokens and collection membership after failed existing-style edits", async () => {
  const document = await Document(undefined, textContext);
  const styles = document.styles;
  const retained = styles.add_style("Retained channel", WD_STYLE_TYPE.PARAGRAPH);
  const count = styles.length;
  expect(() =>
    document.store.transaction(() => {
      retained.delete();
      throw new Error("Aborted original deletion");
    })
  ).toThrow("Aborted original deletion");
  expect(retained.name).toBe("Retained channel");
  expect(styles.length).toBe(count);
  expect(() =>
    document.store.transaction(() => {
      styles.add_style("Transient channel", WD_STYLE_TYPE.PARAGRAPH);
      throw new Error("Aborted original creation");
    })
  ).toThrow("Aborted original creation");
  expect(styles.length).toBe(count);
  expect(styles.at("Retained channel").equals(retained)).toBe(true);
});

it("captures mutable declarative batch widths before asynchronous document admission", async () => {
  const width = { value: 2, unit: "in" };
  const pending = applyStyleModelBatch(
    await textFixture("<w:sectPr/>"),
    {
      version: 1,
      operations: [
        {
          operation: "model.document.Document.comments.get",
          receiver: { resultHandle: "document" },
          arguments: {},
          resultHandle: "comments"
        },
        {
          operation: "model.comments.Comments.add_comment.call",
          receiver: { resultHandle: "comments" },
          arguments: {},
          resultHandle: "comment"
        },
        {
          operation: "model.comments.Comment.add_table.call",
          receiver: { resultHandle: "comment" },
          arguments: { rows: 1, cols: 1, width },
          resultHandle: "table"
        },
        {
          operation: "model.table.Table.columns.get",
          receiver: { resultHandle: "table" },
          arguments: {},
          resultHandle: "columns"
        },
        {
          operation: "model.table._Columns.__getitem__.get",
          receiver: { resultHandle: "columns" },
          arguments: { index: 0 },
          resultHandle: "column"
        },
        {
          operation: "model.table._Column.width.get",
          receiver: { resultHandle: "column" },
          arguments: {}
        }
      ]
    },
    textContext
  );
  width.value = 5;
  const result = await pending;
  expect(result.results.at(-1)?.value).toEqual({ value: 1828800, unit: "emu" });
});
it("resolves named live section-collection index selectors through typed batch", async () => {
  const result = await applyStyleModelBatch(
    await textFixture("<w:sectPr/>"),
    {
      version: 1,
      operations: [
        {
          operation: "model.document.Document.sections.get",
          receiver: { resultHandle: "document" },
          arguments: {},
          resultHandle: "sections"
        },
        {
          operation: "model.section.Section.page_width.get",
          receiver: { resultHandle: "sections", index: 0 },
          arguments: {}
        }
      ]
    },
    textContext
  );
  expect(result.results.at(-1)?.value).toBeNull();
});
it.each(["header", "footer"] as const)(
  "returns the newly added %s table when the existing final block is a table",
  async (key) => {
    const document = await Document(await textFixture("<w:sectPr/>"), textContext);
    const story = document.sections.at(0)[key];
    const first = story.add_table(1, 1, Inches(2));
    const second = story.add_table(1, 1, Inches(3));
    second.cell(0, 0).text = "Second station";
    expect(first.cell(0, 0).text).toBe("");
    expect(story.tables.at(-1)?.cell(0, 0).text).toBe("Second station");
  }
);
it("retains the same document package owner after a failed lazy-style transaction", async () => {
  const document = await Document(
    await textFixture(paragraph("Signal") + "<w:sectPr/>"),
    textContext
  );
  const part = document.part;
  expect(() =>
    document.store.transaction(() => {
      document.styles.add_style("Transient owner", WD_STYLE_TYPE.PARAGRAPH);
      throw new Error("Aborted original owner change");
    })
  ).toThrow("Aborted original owner change");
  expect(document.part.package).toBe(part.package);
});
