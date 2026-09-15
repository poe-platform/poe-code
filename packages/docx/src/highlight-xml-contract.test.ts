import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Font, WD_COLOR_INDEX, formatDocumentRuns, getDocumentXml, parseDocumentXml } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const colors = [
  [WD_COLOR_INDEX.AUTO, "default"], [WD_COLOR_INDEX.BLACK, "black"],
  [WD_COLOR_INDEX.BLUE, "blue"], [WD_COLOR_INDEX.BRIGHT_GREEN, "green"],
  [WD_COLOR_INDEX.DARK_BLUE, "darkBlue"], [WD_COLOR_INDEX.DARK_RED, "darkRed"],
  [WD_COLOR_INDEX.DARK_YELLOW, "darkYellow"], [WD_COLOR_INDEX.GRAY_25, "lightGray"],
  [WD_COLOR_INDEX.GRAY_50, "darkGray"], [WD_COLOR_INDEX.GREEN, "darkGreen"],
  [WD_COLOR_INDEX.PINK, "magenta"], [WD_COLOR_INDEX.RED, "red"],
  [WD_COLOR_INDEX.TEAL, "darkCyan"], [WD_COLOR_INDEX.TURQUOISE, "cyan"],
  [WD_COLOR_INDEX.VIOLET, "darkMagenta"], [WD_COLOR_INDEX.WHITE, "white"],
  [WD_COLOR_INDEX.YELLOW, "yellow"]
] as const;

it.each(colors)("serializes the exact highlight XML value for %s", (color, lexical) => {
  const source = `<w:r xmlns:w="${w}"><w:rPr><w:b w:val="0"/></w:rPr><w:t>潮 🌿</w:t></w:r>`;
  const fs = Volume.fromJSON({ "/run.xml": source });
  const owner = { getXml: () => fs.readFileSync("/run.xml", "utf8") as string,
    setXml: (xml: string) => { fs.writeFileSync("/run.xml", xml); } };
  const font = new Font(owner);
  expect(font.highlight_color).toBeNull();
  font.highlight_color = color;
  expect(font.highlight_color).toEqual(color);
  const props = font.element.children[0]!;
  expect(props.children.map(node => [node.localName, node.attributes.filter(a => a.namespace === w).map(a => [a.localName, a.value])]))
    .toEqual([["b", [["val", "0"]]], ["highlight", [["val", lexical]]]]);
  expect(owner.getXml()).toContain('<w:t>潮 🌿</w:t>');
  expect(font.bold).toBe(false);
  font.highlight_color = null;
  expect(font.highlight_color).toBeNull();
  expect(font.element.children[0]!.children.map(node => node.localName)).toEqual(["b"]);
});

it.each([false, true])("publishes the same automatic highlight XML through the operation SDK in dialect %s", async strict => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:highlight w:val="yellow"/><w:rtl w:val="0"/></w:rPr><w:t>潮 🌿</w:t></w:r></w:p>', {}, strict);
  const fs = Volume.fromJSON({ "/output": "" });
  await formatDocumentRuns(input, { paragraph: 1, run: 1, highlight: WD_COLOR_INDEX.AUTO, output: "-" }, {
    ...textContext, encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } }
  });
  const output = new Uint8Array(fs.readFileSync("/output") as Uint8Array);
  const xml = await getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array;
  const root = parseDocumentXml(xml).root;
  const run = root.children[0]!.children[0]!.children[0]!;
  const props = run.children[0]!;
  expect(props.children.map(node => [node.localName, node.attributes.filter(a => a.namespace === root.namespace).map(a => [a.localName, a.value])]))
    .toEqual([["highlight", [["val", "default"]]], ["rtl", [["val", "0"]]]]);
  expect(run.children[1]!.text).toBe("潮 🌿");
  expect(new TextDecoder().decode(await getDocumentXml(input, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array))
    .toContain('<w:highlight w:val="yellow"/>');
});
