import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  type DocumentView,
  applyStyleModelBatch,
  createDocxInspectionCommandEngine,
  Inches,
  Pt,
  RGBColor,
  ParagraphStyle,
  WD_STYLE_TYPE,
  WD_ORIENT,
  WD_SECTION_START,
  WD_ALIGN_PARAGRAPH,
  WD_UNDERLINE,
  WD_TAB_ALIGNMENT,
  WD_TAB_LEADER,
  type DocumentModelContext
} from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import {
  rasterPng,
  rasterGif,
  rasterBmp,
  rasterJpeg,
  rasterTiff
} from "../tests/fixtures/raster.js";

const timestamp = "2026-09-15T12:34:56.000Z";
const context: DocumentModelContext = { timestamp: new Date(timestamp), author: "Surveyor" };
const doc = "model.document.Document";
const para = "model.text.paragraph.Paragraph";
const run = "model.text.run.Run";
const section = "model.section.Section";
const styles = "model.styles.styles.Styles";
const table = "model.table.Table";
const cell = "model.table._Cell";

class WorkflowBatch {
  readonly operations: {
    operation: string;
    receiver?: { resultHandle: string; index?: number };
    arguments: Record<string, unknown>;
    resultHandle?: string;
  }[] = [];
  add(
    operation: string,
    receiver: string | { resultHandle: string; index: number } | null,
    args: Record<string, unknown> = {},
    resultHandle?: string
  ) {
    this.operations.push({
      operation,
      ...(receiver === null
        ? {}
        : { receiver: typeof receiver === "string" ? { resultHandle: receiver } : receiver }),
      arguments: args,
      ...(resultHandle ? { resultHandle } : {})
    });
    return this;
  }
}
interface Workflow {
  name: string;
  seed?: string;
  model(document: DocumentView): void | Promise<void>;
  batch(): WorkflowBatch;
  check(document: DocumentView): void;
}
const image = rasterPng();
const binary = { kind: "bytes", base64: btoa(String.fromCharCode(...image)) };

const workflows: Workflow[] = [
  {
    name: "quickstart",
    async model(d) {
      d.add_heading("Coastal survey", 0);
      d.add_heading("Observations", 1);
      const p = d.add_paragraph("Spring ");
      p.add_run("tides").bold = true;
      const emphasis = d.styles.add_style("Coast emphasis", WD_STYLE_TYPE.CHARACTER);
      p.add_run(" verified", emphasis).italic = true;
      d.add_page_break();
      d.add_table(1, 2).cell(0, 0).text = "Station";
      await d.add_picture(image, Inches(1));
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.add_heading.call`, "document", { text: "Coastal survey", level: 0 })
        .add(`${doc}.add_heading.call`, "document", { text: "Observations", level: 1 })
        .add(`${doc}.add_paragraph.call`, "document", { text: "Spring " }, "p")
        .add(`${para}.add_run.call`, "p", { text: "tides" }, "r")
        .add(`${run}.bold.set`, "r", { value: true })
        .add(`${doc}.styles.get`, "document", {}, "styles")
        .add(
          `${styles}.add_style.call`,
          "styles",
          { name: "Coast emphasis", styleType: WD_STYLE_TYPE.CHARACTER },
          "emphasis"
        )
        .add(
          `${para}.add_run.call`,
          "p",
          { text: " verified", style: { resultHandle: "emphasis" } },
          "i"
        )
        .add(`${run}.italic.set`, "i", { value: true })
        .add(`${doc}.add_page_break.call`, "document")
        .add(`${doc}.add_table.call`, "document", { rows: 1, cols: 2 }, "t")
        .add(`${table}.cell.call`, "t", { rowIdx: 0, colIdx: 0 }, "c")
        .add(`${cell}.text.set`, "c", { value: "Station" })
        .add(`${doc}.add_picture.call`, "document", {
          input: binary,
          width: { value: 1, unit: "in" }
        }),
    check(d) {
      expect(d.paragraphs.slice(0, 4).map((p) => p.text)).toEqual([
        "Coastal survey",
        "Observations",
        "Spring tides verified",
        ""
      ]);
      expect(d.paragraphs[0]!.style?.name).toBe("Title");
      expect(d.paragraphs[1]!.style?.name).toBe("Heading 1");
      expect(d.paragraphs[2]!.runs.map((r) => [r.bold, r.italic])).toEqual([
        [null, null],
        [true, null],
        [null, true]
      ]);
      expect(d.paragraphs[2]!.runs[2]!.style?.name).toBe("Coast emphasis");
      expect(d.tables[0]!.cell(0, 0).text).toBe("Station");
      expect(d.inline_shapes.at(0).width.emu).toBe(914400);
    }
  },
  {
    name: "header-zones",
    model(d) {
      const first = d.sections.at(0);
      first.header.paragraphs[0]!.text = "West\tCenter\tEast";
      const second = d.add_section();
      expect(second.header.paragraphs[0]!.text).toBe("West\tCenter\tEast");
      second.header.is_linked_to_previous = false;
      second.header.paragraphs[0]!.text = "Local";
      second.header.is_linked_to_previous = true;
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.sections.get`, "document", {}, "sections")
        .add("model.section.Sections.__getitem__.get", "sections", { index: 0 }, "first")
        .add(`${section}.header.get`, "first", {}, "h")
        .add("model.section._Header.paragraphs.get", "h", {}, "ps")
        .add(`${para}.text.set`, { resultHandle: "ps", index: 0 }, { value: "West\tCenter\tEast" })
        .add(`${doc}.add_section.call`, "document", {}, "second")
        .add(`${section}.header.get`, "second", {}, "h2")
        .add("model.section._Header.is_linked_to_previous.set", "h2", { value: false })
        .add("model.section._Header.paragraphs.get", "h2", {}, "local")
        .add(`${para}.text.set`, { resultHandle: "local", index: 0 }, { value: "Local" })
        .add("model.section._Header.is_linked_to_previous.set", "h2", { value: true }),
    check(d) {
      expect(d.sections).toHaveLength(2);
      expect(d.sections.at(0).header.paragraphs[0]!.text).toBe("West\tCenter\tEast");
      expect(d.sections.at(1).header.is_linked_to_previous).toBe(true);
      expect(d.sections.at(1).header.paragraphs[0]!.text).toBe("West\tCenter\tEast");
    }
  },
  {
    name: "rich-comment",
    async model(d) {
      const anchor = d.add_paragraph().add_run("Verified range");
      const c = d.add_comment(anchor, "Review", "Surveyor", "S");
      c.add_paragraph("Rich note").add_run(" emphasized").bold = true;
      c.add_table(1, 1, Inches(1)).cell(0, 0).text = "Evidence";
      await c.add_paragraph().add_run().add_picture(image);
      c.author = "Reviewer";
      c.initials = null;
      expect(d.comments.get(c.comment_id)?.timestamp?.toISOString()).toBe(timestamp);
      expect(d.comments.get(99)).toBeNull();
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.add_paragraph.call`, "document", {}, "p")
        .add(`${para}.add_run.call`, "p", { text: "Verified range" }, "anchor")
        .add(
          `${doc}.add_comment.call`,
          "document",
          { runs: { resultHandle: "anchor" }, text: "Review", author: "Surveyor", initials: "S" },
          "comment"
        )
        .add("model.comments.Comment.add_paragraph.call", "comment", { text: "Rich note" }, "note")
        .add(`${para}.add_run.call`, "note", { text: " emphasized" }, "em")
        .add(`${run}.bold.set`, "em", { value: true })
        .add(
          "model.comments.Comment.add_table.call",
          "comment",
          { rows: 1, cols: 1, width: { value: 1, unit: "in" } },
          "t"
        )
        .add(`${table}.cell.call`, "t", { rowIdx: 0, colIdx: 0 }, "c")
        .add(`${cell}.text.set`, "c", { value: "Evidence" })
        .add("model.comments.Comment.add_paragraph.call", "comment", {}, "picture")
        .add(`${para}.add_run.call`, "picture", {}, "picrun")
        .add(`${run}.add_picture.call`, "picrun", { input: binary })
        .add("model.comments.Comment.author.set", "comment", { value: "Reviewer" })
        .add("model.comments.Comment.initials.set", "comment", { value: null }),
    check(d) {
      const c = d.comments.get(0)!;
      expect(c.author).toBe("Reviewer");
      expect(c.initials).toBeNull();
      expect(c.timestamp?.toISOString()).toBe(timestamp);
      expect(c.paragraphs.slice(0, 2).map((p) => p.text)).toEqual([
        "Review",
        "Rich note emphasized"
      ]);
      expect(c.paragraphs[1]!.runs[1]!.bold).toBe(true);
      expect(c.tables[0]!.cell(0, 0).text).toBe("Evidence");
      expect([...c.paragraphs.at(-1)!.runs[0]!.iter_inner_content()]).toHaveLength(1);
      expect(d.comments.get(99)).toBeNull();
    }
  },
  {
    name: "table-grid",
    model(d) {
      const t = d.add_table(3, 3);
      t.cell(0, 0).text = "North";
      t.cell(0, 1).text = "East";
      t.cell(0, 0).merge(t.cell(0, 1));
      t.cell(1, 1).add_table(1, 1).cell(0, 0).text = "Nested";
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.add_table.call`, "document", { rows: 3, cols: 3 }, "t")
        .add(`${table}.cell.call`, "t", { rowIdx: 0, colIdx: 0 }, "a")
        .add(`${cell}.text.set`, "a", { value: "North" })
        .add(`${table}.cell.call`, "t", { rowIdx: 0, colIdx: 1 }, "b")
        .add(`${cell}.text.set`, "b", { value: "East" })
        .add(`${cell}.merge.call`, "a", { otherCell: { resultHandle: "b" } })
        .add(`${table}.cell.call`, "t", { rowIdx: 1, colIdx: 1 }, "c")
        .add(`${cell}.add_table.call`, "c", { rows: 1, cols: 1 }, "nested")
        .add(`${table}.cell.call`, "nested", { rowIdx: 0, colIdx: 0 }, "nc")
        .add(`${cell}.text.set`, "nc", { value: "Nested" }),
    check(d) {
      const t = d.tables[0]!;
      expect(t.rows).toHaveLength(3);
      expect(t.rows.at(0).cells).toHaveLength(3);
      expect(t.cell(0, 0).element).toBe(t.cell(0, 1).element);
      expect(t.cell(0, 1).text).toBe("North\nEast");
      expect(t.rows.at(0).grid_cols_before).toBe(0);
      expect(t.rows.at(0).grid_cols_after).toBe(0);
      expect(
        [...t.cell(1, 1).iter_inner_content()].map((b) =>
          b instanceof Object && "text" in b ? b.text : "table"
        )
      ).toEqual(["", "table", ""]);
      expect(t.cell(1, 1).tables[0]!.cell(0, 0).text).toBe("Nested");
    }
  },
  {
    name: "style-inheritance",
    model(d) {
      const base = d.styles.add_style("Coast base", WD_STYLE_TYPE.PARAGRAPH);
      const derived = d.styles.add_style("Coast detail", WD_STYLE_TYPE.PARAGRAPH);
      derived.base_style = base;
      base.font.bold = true;
      base.hidden = false;
      base.locked = true;
      base.quick_style = true;
      base.unhide_when_used = true;
      base.priority = 7;
      base.next_paragraph_style = null;
      derived.font.bold = false;
      derived.paragraph_format.space_after = Pt(12);
      d.add_paragraph("Retained text", derived);
      const defaults = d.styles.latent_styles;
      defaults.default_priority = 7;
      defaults.default_to_hidden = false;
      defaults.default_to_locked = true;
      defaults.default_to_quick_style = true;
      defaults.default_to_unhide_when_used = true;
      defaults.load_count = 9;
      defaults.add_latent_style("Temporary").delete();
      const latent = defaults.add_latent_style("Coast detail");
      latent.hidden = false;
      latent.hidden = null;
      derived.delete();
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.styles.get`, "document", {}, "styles")
        .add(
          `${styles}.add_style.call`,
          "styles",
          { name: "Coast base", styleType: WD_STYLE_TYPE.PARAGRAPH },
          "base"
        )
        .add(
          `${styles}.add_style.call`,
          "styles",
          { name: "Coast detail", styleType: WD_STYLE_TYPE.PARAGRAPH },
          "derived"
        )
        .add("model.styles.style.ParagraphStyle.base_style.set", "derived", {
          value: { resultHandle: "base" }
        })
        .add("model.styles.style.ParagraphStyle.font.get", "base", {}, "bf")
        .add("model.text.run.Font.bold.set", "bf", { value: true })
        .add("model.styles.style.ParagraphStyle.hidden.set", "base", { value: false })
        .add("model.styles.style.ParagraphStyle.locked.set", "base", { value: true })
        .add("model.styles.style.ParagraphStyle.quick_style.set", "base", { value: true })
        .add("model.styles.style.ParagraphStyle.unhide_when_used.set", "base", { value: true })
        .add("model.styles.style.ParagraphStyle.priority.set", "base", { value: 7 })
        .add("model.styles.style.ParagraphStyle.next_paragraph_style.set", "base", { value: null })
        .add("model.styles.style.ParagraphStyle.font.get", "derived", {}, "df")
        .add("model.text.run.Font.bold.set", "df", { value: false })
        .add("model.styles.style.ParagraphStyle.paragraph_format.get", "derived", {}, "pf")
        .add("model.text.parfmt.ParagraphFormat.space_after.set", "pf", {
          value: { value: 12, unit: "pt" }
        })
        .add(`${doc}.add_paragraph.call`, "document", {
          text: "Retained text",
          style: { resultHandle: "derived" }
        })
        .add(`${styles}.latent_styles.get`, "styles", {}, "latent")
        .add("model.styles.latent.LatentStyles.default_priority.set", "latent", { value: 7 })
        .add("model.styles.latent.LatentStyles.default_to_hidden.set", "latent", { value: false })
        .add("model.styles.latent.LatentStyles.default_to_locked.set", "latent", { value: true })
        .add("model.styles.latent.LatentStyles.default_to_quick_style.set", "latent", {
          value: true
        })
        .add("model.styles.latent.LatentStyles.default_to_unhide_when_used.set", "latent", {
          value: true
        })
        .add("model.styles.latent.LatentStyles.load_count.set", "latent", { value: 9 })
        .add(
          "model.styles.latent.LatentStyles.add_latent_style.call",
          "latent",
          { name: "Temporary" },
          "temp"
        )
        .add("model.styles.latent._LatentStyle.delete.call", "temp")
        .add(
          "model.styles.latent.LatentStyles.add_latent_style.call",
          "latent",
          { name: "Coast detail" },
          "ls"
        )
        .add("model.styles.latent._LatentStyle.hidden.set", "ls", { value: false })
        .add("model.styles.latent._LatentStyle.hidden.set", "ls", { value: null })
        .add("model.styles.style.ParagraphStyle.delete.call", "derived"),
    check(d) {
      expect(d.paragraphs[0]!.text).toBe("Retained text");
      expect(d.styles.has("Coast detail")).toBe(false);
      expect((d.styles.at("Coast base") as ParagraphStyle).font.bold).toBe(true);
      const base = d.styles.at("Coast base") as ParagraphStyle;
      expect([
        base.hidden,
        base.locked,
        base.quick_style,
        base.unhide_when_used,
        base.priority
      ]).toEqual([false, true, true, true, 7]);
      expect(base.next_paragraph_style.equals(base)).toBe(true);
      const defaults = d.styles.latent_styles;
      expect([
        defaults.default_priority,
        defaults.default_to_hidden,
        defaults.default_to_locked,
        defaults.default_to_quick_style,
        defaults.default_to_unhide_when_used,
        defaults.load_count
      ]).toEqual([7, false, true, true, true, 9]);
      expect([...defaults].map((s) => s.name)).toEqual(["Coast detail"]);
      expect(defaults.at("Coast detail").hidden).toBeNull();
      expect(() => d.styles.at("Missing")).toThrow();
    }
  },
  {
    name: "inline-picture",
    async model(d) {
      await d.add_picture(image, Inches(1), Inches(2));
    },
    batch: () =>
      new WorkflowBatch().add(`${doc}.add_picture.call`, "document", {
        input: binary,
        width: { value: 1, unit: "in" },
        height: { value: 2, unit: "in" }
      }),
    check(d) {
      expect(d.inline_shapes).toHaveLength(1);
      const shape = d.inline_shapes.at(-1);
      expect([shape.width.emu, shape.height.emu]).toEqual([914400, 1828800]);
      expect([...d.paragraphs[0]!.runs[0]!.iter_inner_content()]).toHaveLength(1);
    }
  },
  {
    name: "paragraph-formatting",
    model(d) {
      const p = d.add_paragraph("Coast");
      p.alignment = WD_ALIGN_PARAGRAPH.CENTER;
      const f = p.paragraph_format;
      f.first_line_indent = Inches(-0.25);
      f.line_spacing = 1.5;
      expect(f.line_spacing).toBe(1.5);
      f.line_spacing = Pt(18);
      f.space_after = Pt(12);
      f.keep_with_next = false;
      f.keep_together = true;
      f.page_break_before = null;
      f.tab_stops.add_tab_stop(Inches(1), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS);
      const r = p.add_run(" colored");
      r.underline = WD_UNDERLINE.DOUBLE;
      r.font.color.rgb = RGBColor.from_string("19aBbC");
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.add_paragraph.call`, "document", { text: "Coast" }, "p")
        .add(`${para}.alignment.set`, "p", { value: WD_ALIGN_PARAGRAPH.CENTER })
        .add(`${para}.paragraph_format.get`, "p", {}, "f")
        .add("model.text.parfmt.ParagraphFormat.first_line_indent.set", "f", {
          value: { value: -0.25, unit: "in" }
        })
        .add("model.text.parfmt.ParagraphFormat.line_spacing.set", "f", { value: 1.5 })
        .add("model.text.parfmt.ParagraphFormat.line_spacing.get", "f")
        .add("model.text.parfmt.ParagraphFormat.line_spacing.set", "f", {
          value: { value: 18, unit: "pt" }
        })
        .add("model.text.parfmt.ParagraphFormat.space_after.set", "f", {
          value: { value: 12, unit: "pt" }
        })
        .add("model.text.parfmt.ParagraphFormat.keep_with_next.set", "f", { value: false })
        .add("model.text.parfmt.ParagraphFormat.keep_together.set", "f", { value: true })
        .add("model.text.parfmt.ParagraphFormat.page_break_before.set", "f", { value: null })
        .add("model.text.parfmt.ParagraphFormat.tab_stops.get", "f", {}, "tabs")
        .add("model.text.tabstops.TabStops.add_tab_stop.call", "tabs", {
          position: { value: 1, unit: "in" },
          alignment: WD_TAB_ALIGNMENT.RIGHT,
          leader: WD_TAB_LEADER.DOTS
        })
        .add(`${para}.add_run.call`, "p", { text: " colored" }, "r")
        .add(`${run}.underline.set`, "r", { value: WD_UNDERLINE.DOUBLE })
        .add(`${run}.font.get`, "r", {}, "font")
        .add("model.text.run.Font.color.get", "font", {}, "color")
        .add("model.dml.color.ColorFormat.rgb.set", "color", { value: "19aBbC" }),
    check(d) {
      const p = d.paragraphs[0]!,
        f = p.paragraph_format;
      expect(p.text).toBe("Coast colored");
      expect(p.alignment).toEqual(WD_ALIGN_PARAGRAPH.CENTER);
      expect((f.line_spacing as ReturnType<typeof Pt>).pt).toBe(18);
      expect(f.first_line_indent?.emu).toBe(-228600);
      expect([f.keep_with_next, f.keep_together, f.page_break_before]).toEqual([false, true, null]);
      expect(f.tab_stops.at(0).position.emu).toBe(914400);
      expect(f.tab_stops.at(0).leader).toEqual(WD_TAB_LEADER.DOTS);
      expect(p.runs[1]!.font.color.rgb?.toString()).toBe("19ABBC");
      expect(p.runs[1]!.underline).toEqual(WD_UNDERLINE.DOUBLE);
    }
  },
  {
    name: "section-geometry",
    model(d) {
      const s = d.add_section(WD_SECTION_START.EVEN_PAGE);
      const before = [s.page_width?.emu, s.page_height?.emu];
      s.orientation = WD_ORIENT.LANDSCAPE;
      expect([s.page_width?.emu, s.page_height?.emu]).toEqual(before);
      s.left_margin = Inches(0.5);
      s.right_margin = Inches(0.75);
      s.page_width = Inches(11);
      s.page_height = Inches(8.5);
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.add_section.call`, "document", { startType: WD_SECTION_START.EVEN_PAGE }, "s")
        .add(`${section}.orientation.set`, "s", { value: WD_ORIENT.LANDSCAPE })
        .add(`${section}.left_margin.set`, "s", { value: { value: 0.5, unit: "in" } })
        .add(`${section}.right_margin.set`, "s", { value: { value: 0.75, unit: "in" } })
        .add(`${section}.page_width.set`, "s", { value: { value: 11, unit: "in" } })
        .add(`${section}.page_height.set`, "s", { value: { value: 8.5, unit: "in" } }),
    check(d) {
      expect(d.sections).toHaveLength(2);
      const s = d.sections.at(-1);
      expect(s.orientation).toBe(WD_ORIENT.LANDSCAPE);
      expect(s.start_type).toBe(WD_SECTION_START.EVEN_PAGE);
      expect([
        s.left_margin?.emu,
        s.right_margin?.emu,
        s.page_width?.emu,
        s.page_height?.emu
      ]).toEqual([457200, 685800, 10058400, 7772400]);
      for (const h of [
        s.header,
        s.footer,
        s.first_page_header,
        s.first_page_footer,
        s.even_page_header,
        s.even_page_footer
      ])
        expect(h.is_linked_to_previous).toBe(true);
    }
  },
  {
    name: "style-identification",
    model(d) {
      const s = d.styles.add_style("Estuary notes", WD_STYLE_TYPE.PARAGRAPH);
      d.add_paragraph("Style sample", s);
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.styles.get`, "document", {}, "styles")
        .add(
          `${styles}.add_style.call`,
          "styles",
          { name: "Estuary notes", styleType: WD_STYLE_TYPE.PARAGRAPH },
          "s"
        )
        .add(`${doc}.add_paragraph.call`, "document", {
          text: "Style sample",
          style: { resultHandle: "s" }
        }),
    check(d) {
      const s = d.styles.at("Estuary notes");
      expect([s.name, s.style_id, s.type]).toEqual([
        "Estuary notes",
        "Style1",
        WD_STYLE_TYPE.PARAGRAPH
      ]);
      expect(d.paragraphs[0]!.style?.equals(s)).toBe(true);
    }
  },
  {
    name: "inline-block-traversal",
    model(d) {
      const p = d.add_paragraph("Old");
      p.paragraph_format.keep_together = true;
      const r = p.add_run("Run");
      r.bold = true;
      r.text = "New";
      expect(r.bold).toBe(true);
      r.clear();
      expect(r.bold).toBe(true);
      p.text = "Replacement";
      d.add_table(1, 1);
      d.add_paragraph("Last");
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.add_paragraph.call`, "document", { text: "Old" }, "p")
        .add(`${para}.paragraph_format.get`, "p", {}, "f")
        .add("model.text.parfmt.ParagraphFormat.keep_together.set", "f", { value: true })
        .add(`${para}.add_run.call`, "p", { text: "Run" }, "r")
        .add(`${run}.bold.set`, "r", { value: true })
        .add(`${run}.text.set`, "r", { value: "New" })
        .add(`${run}.clear.call`, "r")
        .add(`${para}.text.set`, "p", { value: "Replacement" })
        .add(`${doc}.add_table.call`, "document", { rows: 1, cols: 1 })
        .add(`${doc}.add_paragraph.call`, "document", { text: "Last" }),
    check(d) {
      expect([...d.iter_inner_content()].map((b) => ("text" in b ? b.text : "table"))).toEqual([
        "Replacement",
        "table",
        "Last"
      ]);
      expect([...d.paragraphs[0]!.iter_inner_content()].map((r) => r.text)).toEqual([
        "Replacement"
      ]);
      expect(d.paragraphs[0]!.runs[0]!.bold).toBeNull();
      expect(d.paragraphs[0]!.paragraph_format.keep_together).toBe(true);
    }
  },
  {
    name: "table-omitted",
    seed: '<w:tbl><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>',
    model(d) {
      d.tables[0]!.cell(0, 1).text = "Occupied";
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.tables.get`, "document", {}, "tables")
        .add(
          `${table}.cell.call`,
          { resultHandle: "tables", index: 0 },
          { rowIdx: 0, colIdx: 1 },
          "c"
        )
        .add(`${cell}.text.set`, "c", { value: "Occupied" }),
    check(d) {
      const t = d.tables[0]!;
      expect(t.rows.at(0).grid_cols_before).toBe(1);
      expect(t.rows.at(0).grid_cols_after).toBe(0);
      expect(t.rows.at(0).cells.map((c) => c.text)).toEqual(["Occupied", ""]);
      expect(t.rows.at(1).cells).toHaveLength(3);
      expect(t.cell(1, 0).element).toBe(t.cell(1, 1).element);
      expect(() => t.cell(0, 0)).toThrow();
    }
  },
  {
    name: "xml-removal",
    seed: "<w:p><w:r><w:t>Remove</w:t></w:r></w:p><w:p><w:r><w:t>Retain</w:t></w:r></w:p>",
    model(d) {
      d.paragraphs[0]!.element.remove();
    },
    batch: () =>
      new WorkflowBatch()
        .add(`${doc}.part.get`, "document", {}, "part")
        .add("model.parts.document.DocumentPart.element.get", "part", {}, "root")
        .add("model.XmlElementView.children.get", "root", {}, "children")
        .add(
          "model.XmlElementView.children.get",
          { resultHandle: "children", index: 0 },
          {},
          "blocks"
        )
        .add("model.XmlElementView.remove.call", { resultHandle: "blocks", index: 0 }),
    check(d) {
      expect(d.paragraphs.map((p) => p.text)).toEqual(["Retain"]);
    }
  },
  {
    name: "open-stream",
    model(d) {
      d.add_paragraph("Stream record 🌊");
    },
    batch: () =>
      new WorkflowBatch().add(`${doc}.add_paragraph.call`, "document", {
        text: "Stream record 🌊"
      }),
    check(d) {
      expect(d.paragraphs.map((p) => p.text)).toEqual(["Stream record 🌊"]);
    }
  }
];

async function saved(document: {
  save(sink: { write(bytes: Uint8Array): Promise<void> }): Promise<void>;
}) {
  const volume = Volume.fromJSON({ "/saved": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/saved", bytes);
    }
  });
  return new Uint8Array(volume.readFileSync("/saved") as Buffer);
}

it.each(workflows)(
  "executes original $name workflow through public model, SDK and CLI with independent reloaded assertions",
  async (workflow) => {
    const seed = await Document(
      await textFixture(
        (workflow.seed ?? "") +
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr>'
      ),
      context
    );
    const input = await saved(seed);
    const before = new Uint8Array(input);
    const source =
      workflow.name === "open-stream"
        ? {
            async *open() {
              for (let i = 0; i < input.length; i += 97) yield input.subarray(i, i + 97);
            }
          }
        : input;
    const model = await Document(source, context);
    await workflow.model(model);
    workflow.check(await Document(await saved(model), context));

    const batch = { version: 1, operations: workflow.batch().operations };
    const sdk = await applyStyleModelBatch(input, batch, context);
    workflow.check(await Document(await saved(sdk), context));

    for (const dryRun of [true, false]) {
      const volume = Volume.fromJSON({ "/input.docx": "", "/stdout": "", "/stderr": "" });
      volume.writeFileSync("/input.docx", input);
      const args = [
        "batch",
        workflow.name === "open-stream" ? "-" : "/input.docx",
        "--ops-json",
        JSON.stringify(batch),
        "--timestamp",
        timestamp,
        "--author",
        "Surveyor",
        ...(dryRun ? ["--dry-run", "--json"] : ["--output", "-"])
      ];
      const result = await createDocxInspectionCommandEngine({
        limits: textContext.limits
      }).execute({
        args: args.map((arg) => new TextEncoder().encode(arg)),
        cwd: "/",
        signal: new AbortController().signal,
        filesystem: {
          async readFile(path) {
            return new Uint8Array(volume.readFileSync(path) as Buffer);
          }
        },
        stdin: {
          async *[Symbol.asyncIterator]() {
            if (workflow.name === "open-stream") yield input;
          }
        },
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/stdout", bytes);
          }
        },
        stderr: {
          async write(bytes) {
            volume.appendFileSync("/stderr", bytes);
          }
        }
      });
      expect(volume.readFileSync("/stderr", "utf8"), workflow.name).toBe("");
      expect(result.exitCode, workflow.name).toBe(0);
      if (dryRun) {
        const output = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
        expect(output).toMatchObject({
          version: 1,
          operation: "batch",
          ok: true,
          errors: [],
          affected: sdk.affected,
          data: { output: [] }
        });
        expect(output.data.results).toEqual(sdk.results);
      } else
        workflow.check(
          await Document(new Uint8Array(volume.readFileSync("/stdout") as Buffer), context)
        );
      expect(new Uint8Array(volume.readFileSync("/input.docx") as Buffer)).toEqual(before);
    }
    expect(input).toEqual(before);
  }
);

it.each([rasterPng(), rasterGif(), rasterBmp(), rasterJpeg(), rasterTiff()])(
  "inserts original characterized picture bytes without a host decoder",
  async (bytes) => {
    const document = await Document(undefined, context);
    await document.add_picture(bytes);
    const reopened = await Document(await saved(document), context);
    expect(reopened.inline_shapes).toHaveLength(1);
    expect(reopened.inline_shapes.at(0).width.emu).toBeGreaterThan(0);
  }
);
