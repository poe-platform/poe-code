import { expect, it } from "vitest";
import { readGnumeric, writeGnumeric } from "../codecs/gnumeric.js";
import { sheetObjects } from "./index.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };

it("exposes drawing and chart paint metadata without resolving fonts or image resources", async () => {
  const xml = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectFilled Name="Caption" Label="Original text"><Style type="GOStyle"><outline color="112233FF" width="2"/><fill type="pattern"><pattern type="1" fore="334455FF" back="FFFFFFFF"/></fill><font font="Serif 12" color="000000FF"/><text_layout angle="30"/></Style></g:SheetObjectFilled><g:SheetObjectGraph><GogObject type="GogGraph"><GogObject type="GogChart" role="Chart"><property name="style" type="GogStyle"><line color="AABBCCFF" width="1.5"/><fill type="image"><image name="embedded-only" type="stretch"/></fill><marker shape="diamond"/></property></GogObject></GogObject></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(xml), context);
  const objects = sheetObjects(book.sheets[0]!, context);
  expect(objects[0]).toMatchObject({ text: "Original text", style: { type: "GOStyle", outline: { color: "112233FF", width: "2" }, fill: { attributes: { type: "pattern" }, pattern: { fore: "334455FF", back: "FFFFFFFF" } }, font: { font: "Serif 12" }, textLayout: { angle: "30" } } });
  expect(objects[1]!.graph!.children[0]).toMatchObject({ style: { type: "GogStyle", line: { color: "AABBCCFF" }, marker: { shape: "diamond" }, fill: { image: { name: "embedded-only", type: "stretch" } } } });
  const canonical = await writeGnumeric(book, [], context);
  const round = await readGnumeric(canonical, context);
  expect(sheetObjects(round.sheets[0]!, context).map(object => [object.style, object.graph?.children[0]?.style, object.text])).toEqual(objects.map(object => [object.style, object.graph?.children[0]?.style, object.text]));
});
