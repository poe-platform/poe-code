import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  Emu,
  WD_STYLE_TYPE,
  WD_TAB_ALIGNMENT,
  WD_TAB_LEADER,
  Font,
  ParagraphFormat,
  LatentStyles,
  BaseStyle,
  TabStop
} from "./index.js";
import { paragraph, textFixture, textContext, w } from "../tests/fixtures/text.js";

type Case = {
  label: string;
  kind: string;
  write: boolean;
  property?: string;
  type?: string;
  builtin?: boolean;
  initial?: unknown;
  assigned?: unknown;
  expected?: unknown;
  count?: number;
};
const cases: Case[] = [
  {
    label: "style workflow 001",
    kind: "font",
    write: false,
    type: "CHARACTER"
  },
  {
    label: "style workflow 002",
    kind: "font",
    write: false,
    type: "PARAGRAPH"
  },
  {
    label: "style workflow 003",
    kind: "font",
    write: false,
    type: "TABLE"
  },
  {
    label: "style workflow 004",
    kind: "latent-collection",
    write: false
  },
  {
    label: "style workflow 005",
    kind: "latent-lookup",
    write: false
  },
  {
    label: "style workflow 006",
    kind: "paragraph-format",
    write: false,
    type: "PARAGRAPH"
  },
  {
    label: "style workflow 007",
    kind: "paragraph-format",
    write: false,
    type: "TABLE"
  },
  {
    label: "style workflow 008",
    kind: "add-style",
    write: false,
    type: "PARAGRAPH",
    builtin: true
  },
  {
    label: "style workflow 009",
    kind: "add-style",
    write: false,
    type: "CHARACTER",
    builtin: false
  },
  {
    label: "style workflow 010",
    kind: "add-style",
    write: false,
    type: "LIST",
    builtin: true
  },
  {
    label: "style workflow 011",
    kind: "add-style",
    write: false,
    type: "TABLE",
    builtin: false
  },
  {
    label: "style workflow 012",
    kind: "delete-style",
    write: false
  },
  {
    label: "style workflow 013",
    kind: "add-latent",
    write: false
  },
  {
    label: "style workflow 014",
    kind: "delete-latent",
    write: false
  },
  {
    label: "style workflow 015",
    kind: "defaults",
    write: false,
    property: "default_priority",
    expected: 99
  },
  {
    label: "style workflow 016",
    kind: "defaults",
    write: false,
    property: "load_count",
    expected: 276
  },
  {
    label: "style workflow 017",
    kind: "defaults",
    write: false,
    property: "default_to_hidden",
    expected: true
  },
  {
    label: "style workflow 018",
    kind: "defaults",
    write: false,
    property: "default_to_locked",
    expected: false
  },
  {
    label: "style workflow 019",
    kind: "defaults",
    write: false,
    property: "default_to_quick_style",
    expected: false
  },
  {
    label: "style workflow 020",
    kind: "defaults",
    write: false,
    property: "default_to_unhide_when_used",
    expected: true
  },
  {
    label: "style workflow 021",
    kind: "defaults",
    write: true,
    property: "default_priority",
    expected: 42,
    assigned: 42
  },
  {
    label: "style workflow 022",
    kind: "defaults",
    write: true,
    property: "load_count",
    expected: 240,
    assigned: 240
  },
  {
    label: "style workflow 023",
    kind: "defaults",
    write: true,
    property: "default_to_hidden",
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 024",
    kind: "defaults",
    write: true,
    property: "default_to_locked",
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 025",
    kind: "defaults",
    write: true,
    property: "default_to_quick_style",
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 026",
    kind: "defaults",
    write: true,
    property: "default_to_unhide_when_used",
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 027",
    kind: "latent-name",
    write: false
  },
  {
    label: "style workflow 028",
    kind: "latent-property",
    write: false,
    property: "priority",
    initial: null,
    expected: null
  },
  {
    label: "style workflow 029",
    kind: "latent-property",
    write: false,
    property: "priority",
    initial: 42,
    expected: 42
  },
  {
    label: "style workflow 030",
    kind: "latent-property",
    write: true,
    property: "priority",
    initial: null,
    expected: 42,
    assigned: 42
  },
  {
    label: "style workflow 031",
    kind: "latent-property",
    write: true,
    property: "priority",
    initial: 42,
    expected: 24,
    assigned: 24
  },
  {
    label: "style workflow 032",
    kind: "latent-property",
    write: true,
    property: "priority",
    initial: 42,
    expected: null,
    assigned: null
  },
  {
    label: "style workflow 033",
    kind: "latent-property",
    write: false,
    property: "hidden",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 034",
    kind: "latent-property",
    write: false,
    property: "hidden",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 035",
    kind: "latent-property",
    write: false,
    property: "hidden",
    initial: null,
    expected: null
  },
  {
    label: "style workflow 036",
    kind: "latent-property",
    write: false,
    property: "locked",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 037",
    kind: "latent-property",
    write: false,
    property: "locked",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 038",
    kind: "latent-property",
    write: false,
    property: "locked",
    initial: null,
    expected: null
  },
  {
    label: "style workflow 039",
    kind: "latent-property",
    write: false,
    property: "quick_style",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 040",
    kind: "latent-property",
    write: false,
    property: "quick_style",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 041",
    kind: "latent-property",
    write: false,
    property: "quick_style",
    initial: null,
    expected: null
  },
  {
    label: "style workflow 042",
    kind: "latent-property",
    write: false,
    property: "unhide_when_used",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 043",
    kind: "latent-property",
    write: false,
    property: "unhide_when_used",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 044",
    kind: "latent-property",
    write: false,
    property: "unhide_when_used",
    initial: null,
    expected: null
  },
  {
    label: "style workflow 045",
    kind: "latent-property",
    write: true,
    property: "hidden",
    initial: null,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 046",
    kind: "latent-property",
    write: true,
    property: "hidden",
    initial: true,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 047",
    kind: "latent-property",
    write: true,
    property: "hidden",
    initial: false,
    expected: null,
    assigned: null
  },
  {
    label: "style workflow 048",
    kind: "latent-property",
    write: true,
    property: "locked",
    initial: null,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 049",
    kind: "latent-property",
    write: true,
    property: "locked",
    initial: false,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 050",
    kind: "latent-property",
    write: true,
    property: "locked",
    initial: true,
    expected: null,
    assigned: null
  },
  {
    label: "style workflow 051",
    kind: "latent-property",
    write: true,
    property: "quick_style",
    initial: null,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 052",
    kind: "latent-property",
    write: true,
    property: "quick_style",
    initial: true,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 053",
    kind: "latent-property",
    write: true,
    property: "quick_style",
    initial: false,
    expected: null,
    assigned: null
  },
  {
    label: "style workflow 054",
    kind: "latent-property",
    write: true,
    property: "unhide_when_used",
    initial: null,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 055",
    kind: "latent-property",
    write: true,
    property: "unhide_when_used",
    initial: false,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 056",
    kind: "latent-property",
    write: true,
    property: "unhide_when_used",
    initial: true,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 057",
    kind: "base",
    write: false,
    initial: null,
    expected: null
  },
  {
    label: "style workflow 058",
    kind: "base",
    write: false,
    initial: "Anchor",
    expected: "Anchor"
  },
  {
    label: "style workflow 059",
    kind: "base",
    write: true,
    initial: null,
    expected: "Anchor",
    assigned: "Anchor"
  },
  {
    label: "style workflow 060",
    kind: "base",
    write: true,
    initial: "Anchor",
    expected: "Foundation",
    assigned: "Foundation"
  },
  {
    label: "style workflow 061",
    kind: "base",
    write: true,
    initial: "Foundation",
    expected: null,
    assigned: null
  },
  {
    label: "style workflow 062",
    kind: "style-property",
    write: false,
    property: "hidden",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 063",
    kind: "style-property",
    write: false,
    property: "hidden",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 064",
    kind: "style-property",
    write: false,
    property: "hidden",
    initial: null,
    expected: false
  },
  {
    label: "style workflow 065",
    kind: "style-property",
    write: true,
    property: "hidden",
    initial: null,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 066",
    kind: "style-property",
    write: true,
    property: "hidden",
    initial: true,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 067",
    kind: "style-property",
    write: false,
    property: "locked",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 068",
    kind: "style-property",
    write: false,
    property: "locked",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 069",
    kind: "style-property",
    write: false,
    property: "locked",
    initial: null,
    expected: false
  },
  {
    label: "style workflow 070",
    kind: "style-property",
    write: true,
    property: "locked",
    initial: null,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 071",
    kind: "style-property",
    write: true,
    property: "locked",
    initial: true,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 072",
    kind: "name",
    write: false
  },
  {
    label: "style workflow 073",
    kind: "name",
    write: true
  },
  {
    label: "style workflow 074",
    kind: "next",
    write: false,
    initial: null,
    expected: "Harbor"
  },
  {
    label: "style workflow 075",
    kind: "next",
    write: false,
    initial: "Anchor",
    expected: "Anchor"
  },
  {
    label: "style workflow 076",
    kind: "next",
    write: false,
    initial: "missing",
    expected: "Harbor"
  },
  {
    label: "style workflow 077",
    kind: "next",
    write: true,
    initial: null,
    expected: "Annotation",
    assigned: "Annotation"
  },
  {
    label: "style workflow 078",
    kind: "next",
    write: true,
    initial: "Anchor",
    expected: "Foundation",
    assigned: "Foundation"
  },
  {
    label: "style workflow 079",
    kind: "next",
    write: true,
    initial: "Foundation",
    expected: "Harbor",
    assigned: null
  },
  {
    label: "style workflow 080",
    kind: "style-property",
    write: false,
    property: "priority",
    initial: null,
    expected: null
  },
  {
    label: "style workflow 081",
    kind: "style-property",
    write: false,
    property: "priority",
    initial: 42,
    expected: 42
  },
  {
    label: "style workflow 082",
    kind: "style-property",
    write: true,
    property: "priority",
    initial: null,
    expected: 42,
    assigned: 42
  },
  {
    label: "style workflow 083",
    kind: "style-property",
    write: true,
    property: "priority",
    initial: 42,
    expected: 24,
    assigned: 24
  },
  {
    label: "style workflow 084",
    kind: "style-property",
    write: true,
    property: "priority",
    initial: 42,
    expected: null,
    assigned: null
  },
  {
    label: "style workflow 085",
    kind: "style-property",
    write: false,
    property: "quick_style",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 086",
    kind: "style-property",
    write: false,
    property: "quick_style",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 087",
    kind: "style-property",
    write: false,
    property: "quick_style",
    initial: null,
    expected: false
  },
  {
    label: "style workflow 088",
    kind: "style-property",
    write: true,
    property: "quick_style",
    initial: null,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 089",
    kind: "style-property",
    write: true,
    property: "quick_style",
    initial: true,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 090",
    kind: "id",
    write: false
  },
  {
    label: "style workflow 091",
    kind: "id",
    write: true
  },
  {
    label: "style workflow 092",
    kind: "type",
    write: false
  },
  {
    label: "style workflow 093",
    kind: "style-property",
    write: false,
    property: "unhide_when_used",
    initial: true,
    expected: true
  },
  {
    label: "style workflow 094",
    kind: "style-property",
    write: false,
    property: "unhide_when_used",
    initial: false,
    expected: false
  },
  {
    label: "style workflow 095",
    kind: "style-property",
    write: false,
    property: "unhide_when_used",
    initial: null,
    expected: false
  },
  {
    label: "style workflow 096",
    kind: "style-property",
    write: true,
    property: "unhide_when_used",
    initial: null,
    expected: true,
    assigned: true
  },
  {
    label: "style workflow 097",
    kind: "style-property",
    write: true,
    property: "unhide_when_used",
    initial: true,
    expected: false,
    assigned: false
  },
  {
    label: "style workflow 098",
    kind: "tab-count",
    write: false,
    count: 0
  },
  {
    label: "style workflow 099",
    kind: "tab-count",
    write: false,
    count: 3
  },
  {
    label: "style workflow 100",
    kind: "tab-lookup",
    write: false
  },
  {
    label: "style workflow 101",
    kind: "tab-add",
    write: false,
    count: 0,
    expected: 1
  },
  {
    label: "style workflow 102",
    kind: "tab-add",
    write: false,
    count: 3,
    expected: 4
  },
  {
    label: "style workflow 103",
    kind: "tab-delete",
    write: false
  },
  {
    label: "style workflow 104",
    kind: "tab-clear",
    write: false
  },
  {
    label: "style workflow 105",
    kind: "tab-position",
    write: false,
    initial: 457200,
    expected: 457200
  },
  {
    label: "style workflow 106",
    kind: "tab-position",
    write: false,
    initial: -457200,
    expected: -457200
  },
  {
    label: "style workflow 107",
    kind: "tab-position",
    write: true,
    initial: 457200,
    expected: 228600,
    assigned: 228600
  },
  {
    label: "style workflow 108",
    kind: "tab-position",
    write: true,
    initial: 457200,
    expected: -914400,
    assigned: -914400
  },
  {
    label: "style workflow 109",
    kind: "tab-alignment",
    write: false,
    initial: "LEFT",
    expected: "LEFT"
  },
  {
    label: "style workflow 110",
    kind: "tab-alignment",
    write: false,
    initial: "RIGHT",
    expected: "RIGHT"
  },
  {
    label: "style workflow 111",
    kind: "tab-alignment",
    write: true,
    initial: "LEFT",
    expected: "CENTER",
    assigned: "CENTER"
  },
  {
    label: "style workflow 112",
    kind: "tab-alignment",
    write: true,
    initial: "RIGHT",
    expected: "LEFT",
    assigned: "LEFT"
  },
  {
    label: "style workflow 113",
    kind: "tab-leader",
    write: false,
    initial: "SPACES",
    expected: "SPACES"
  },
  {
    label: "style workflow 114",
    kind: "tab-leader",
    write: false,
    initial: "DOTS",
    expected: "DOTS"
  },
  {
    label: "style workflow 115",
    kind: "tab-leader",
    write: true,
    initial: "SPACES",
    expected: "DOTS",
    assigned: "DOTS"
  },
  {
    label: "style workflow 116",
    kind: "tab-leader",
    write: true,
    initial: "DOTS",
    expected: "SPACES",
    assigned: "SPACES"
  }
];

const propertyTags: Record<string, string> = {
  hidden: "semiHidden",
  locked: "locked",
  quick_style: "qFormat",
  unhide_when_used: "unhideWhenUsed",
  priority: "uiPriority"
};
const latentAttributes: Record<string, string> = {
  hidden: "semiHidden",
  locked: "locked",
  quick_style: "qFormat",
  unhide_when_used: "unhideWhenUsed",
  priority: "uiPriority"
};
function styleXml(c: Case): string {
  const type = c.type?.toLowerCase() ?? "paragraph";
  let props = "";
  if (c.kind === "style-property" && c.initial !== null) {
    const value = typeof c.initial === "boolean" ? Number(c.initial) : c.initial;
    props = `<w:${propertyTags[c.property!]} w:val="${value}"/>`;
  }
  if (c.kind === "base" && c.initial) props = `<w:basedOn w:val="${c.initial}"/>`;
  if (c.kind === "next" && c.initial) props = `<w:next w:val="${c.initial}"/>`;
  const entry =
    c.kind === "latent-property" && c.initial !== null
      ? ` w:${latentAttributes[c.property!]}="${typeof c.initial === "boolean" ? Number(c.initial) : c.initial}"`
      : "";
  const count = c.kind === "latent-collection" ? 137 : 3;
  const latent = `<w:latentStyles w:defUIPriority="99" w:count="276" w:defSemiHidden="1" w:defLockedState="0" w:defQFormat="0" w:defUnhideWhenUsed="1">${Array.from({ length: count }, (_, i) => `<w:lsdException w:name="Latent ${i}"${i === 0 ? entry : ""}/>`).join("")}</w:latentStyles>`;
  return `<w:styles xmlns:w="${w}">${latent}<w:style w:type="${type}" w:styleId="Harbor"><w:name w:val="Harbor"/>${props}</w:style>${["Anchor", "Foundation", "Annotation"].map((name) => `<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/></w:style>`).join("")}</w:styles>`;
}
function tabXml(c: Case): string {
  if (!c.kind.startsWith("tab-")) return paragraph("Coastal observations");
  let tabs = "";
  if (["tab-count", "tab-add", "tab-lookup", "tab-delete", "tab-clear"].includes(c.kind)) {
    const count = c.count ?? 3;
    tabs = Array.from(
      { length: count },
      (_, i) => `<w:tab w:pos="${(i + 1) * 1440}" w:val="${["left", "center", "right"][i]}"/>`
    ).join("");
  } else if (c.kind === "tab-position") {
    tabs = `<w:tab w:pos="-720" w:val="left"/><w:tab w:pos="720" w:val="left"/>`;
  } else
    tabs = `<w:tab w:pos="720" w:val="${c.kind === "tab-alignment" ? String(c.initial).toLowerCase() : "left"}"${c.kind === "tab-leader" && c.initial === "DOTS" ? ' w:leader="dot"' : ""}/>`;
  return `<w:p><w:pPr><w:tabs>${tabs}</w:tabs></w:pPr><w:r><w:t>Coastal observations</w:t></w:r></w:p>`;
}

for (const c of cases)
  it(c.label, async () => {
    const input = await textFixture(tabXml(c), { styles: { kind: "styles", xml: styleXml(c) } });
    const volume = Volume.fromJSON({ "/input": Buffer.from(input) });
    const doc = await Document(
      new Uint8Array(volume.readFileSync("/input") as Buffer),
      textContext
    );
    const styles = doc.styles;
    const style = styles.at("Harbor");
    const latent = styles.latent_styles;
    const entry = latent.at("Latent 0");
    switch (c.kind) {
      case "font": {
        const font = Reflect.get(style, "font") as Font;
        expect(font).toBeInstanceOf(Font);
        font.bold = true;
        expect((Reflect.get(styles.at("Harbor"), "font") as Font).bold).toBe(true);
        break;
      }
      case "paragraph-format": {
        const format = Reflect.get(style, "paragraph_format") as ParagraphFormat;
        expect(format).toBeInstanceOf(ParagraphFormat);
        format.keep_with_next = false;
        expect(
          (Reflect.get(styles.at("Harbor"), "paragraph_format") as ParagraphFormat).keep_with_next
        ).toBe(false);
        break;
      }
      case "add-style": {
        const before = styles.length;
        const added = styles.add_style(
          "Coastal detail",
          WD_STYLE_TYPE.members[c.type as keyof typeof WD_STYLE_TYPE.members],
          c.builtin
        );
        expect(styles.length).toBe(before + 1);
        expect(styles.at("Coastal detail")).toBeInstanceOf(BaseStyle);
        expect(added.type).toEqual(
          WD_STYLE_TYPE.members[c.type as keyof typeof WD_STYLE_TYPE.members]
        );
        expect(added.builtin).toBe(c.builtin);
        break;
      }
      case "delete-style": {
        const before = styles.length;
        style.delete();
        expect(styles.length).toBe(before - 1);
        expect(styles.has("Harbor")).toBe(false);
        expect(() => style.name).toThrow();
        break;
      }
      case "latent-collection":
        expect(latent).toBeInstanceOf(LatentStyles);
        expect(latent.length).toBe(137);
        break;
      case "latent-lookup":
        expect([...latent].map((item) => item.name)).toEqual(["Latent 0", "Latent 1", "Latent 2"]);
        expect(latent.at("Latent 1").name).toBe("Latent 1");
        break;
      case "add-latent": {
        const before = latent.length;
        const added = latent.add_latent_style("Coastal latent");
        expect(latent.length).toBe(before + 1);
        expect(latent.at("Coastal latent").name).toBe(added.name);
        break;
      }
      case "delete-latent": {
        const before = latent.length;
        entry.delete();
        expect(latent.length).toBe(before - 1);
        expect([...latent].some((item) => item.name === "Latent 0")).toBe(false);
        expect(() => entry.name).toThrow();
        break;
      }
      case "defaults":
        if (c.write) Reflect.set(latent, c.property!, c.assigned);
        expect(Reflect.get(latent, c.property!)).toBe(c.expected);
        break;
      case "latent-property":
        expect(Reflect.get(entry, c.property!)).toBe(c.initial);
        if (c.write) Reflect.set(entry, c.property!, c.assigned);
        expect(Reflect.get(latent.at("Latent 0"), c.property!)).toBe(c.expected);
        break;
      case "latent-name":
        expect(entry.name).toBe("Latent 0");
        break;
      case "base":
        if (c.write)
          Reflect.set(
            style,
            "base_style",
            c.assigned === null ? null : styles.at(c.assigned as string)
          );
        expect((Reflect.get(style, "base_style") as BaseStyle | null)?.name ?? null).toBe(
          c.expected
        );
        break;
      case "next":
        if (c.write)
          Reflect.set(
            style,
            "next_paragraph_style",
            c.assigned === null ? null : styles.at(c.assigned as string)
          );
        expect((Reflect.get(style, "next_paragraph_style") as BaseStyle).name).toBe(c.expected);
        break;
      case "name":
        if (c.write) style.name = "Harbor renamed";
        expect(style.name).toBe(c.write ? "Harbor renamed" : "Harbor");
        break;
      case "id":
        if (c.write) style.style_id = "HarborRenamed";
        expect(style.style_id).toBe(c.write ? "HarborRenamed" : "Harbor");
        break;
      case "type":
        expect(style.type).toEqual(WD_STYLE_TYPE.PARAGRAPH);
        break;
      case "style-property":
        if (c.write) Reflect.set(style, c.property!, c.assigned);
        expect(Reflect.get(style, c.property!)).toBe(c.expected);
        break;
      default: {
        const tabs = doc.paragraphs[0]!.paragraph_format.tab_stops;
        if (c.kind === "tab-count") expect(tabs.length).toBe(c.count);
        else if (c.kind === "tab-lookup") {
          expect([...tabs]).toHaveLength(3);
          for (let i = 0; i < 3; i++) expect(tabs.at(i)).toBeInstanceOf(TabStop);
        } else if (c.kind === "tab-add") {
          tabs.add_tab_stop({ value: 1.75, unit: "in" });
          expect(tabs.length).toBe(c.expected);
          expect([...tabs].map((t) => t.position.emu)).toEqual(
            c.count ? [914400, 1600200, 1828800, 2743200] : [1600200]
          );
        } else if (c.kind === "tab-delete") {
          tabs.remove(1);
          expect(tabs.length).toBe(2);
          expect([...tabs].map((t) => t.position.emu)).toEqual([914400, 2743200]);
        } else if (c.kind === "tab-clear") {
          tabs.clear_all();
          expect(tabs.length).toBe(0);
        } else if (c.kind === "tab-position") {
          const stop = tabs.at(c.initial === -457200 ? 0 : 1);
          if (c.write) stop.position = Emu(c.assigned as number);
          expect(stop.position.emu).toBe(c.expected);
          const positions = [...tabs].map((t) => t.position.emu);
          expect(positions).toEqual([...positions].sort((a, b) => a - b));
        } else {
          const stop = tabs.at(0);
          const key = c.kind === "tab-alignment" ? "alignment" : "leader";
          if (c.write)
            Reflect.set(
              stop,
              key,
              key === "alignment"
                ? WD_TAB_ALIGNMENT[c.assigned as keyof typeof WD_TAB_ALIGNMENT]
                : WD_TAB_LEADER[c.assigned as keyof typeof WD_TAB_LEADER]
            );
          expect(Reflect.get(stop, key).name).toBe(c.expected);
        }
      }
    }
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  });
