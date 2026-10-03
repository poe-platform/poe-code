import type {BackedJson} from "./backed-json.js";
import type {DelimitedEvents} from "./delimited-parser.js";

/** Emit the existing Pandoc table schema directly into caller-backed nodes.
 * Neither a row, a cell's inline list, nor a long Str needs a resident array. */
export async function appendDelimitedJson(tree: BackedJson, width: number, replay: (events: DelimitedEvents) => Promise<void>): Promise<void> {
  const attr = ["", [], []] as const;
  await tree.begin("object");
  await tree.key("t"); await tree.value("Table");
  await tree.key("c"); await tree.begin("array");
  await tree.value(attr);
  await tree.value([null, []]);
  await tree.begin("array");
  for (let column = 0; column < width; column++) await tree.value([{t: "AlignDefault"}, {t: "ColWidthDefault"}]);
  await tree.end();
  await tree.begin("array"); // head
  await tree.value(attr);
  await tree.begin("array"); // head rows
  let row = 0, column = 0;
  let cell = false, plain = false, str = false;
  const openCell = async () => {
    if (cell) return;
    if (!column) {
      await tree.begin("array"); // row
      await tree.value(attr);
      await tree.begin("array"); // cells
    }
    await tree.begin("array");
    await tree.value(attr);
    await tree.value({t: "AlignDefault"});
    await tree.value(1); await tree.value(1);
    await tree.begin("array"); // cell blocks
    cell = true;
  };
  const closeString = async () => {
    if (!str) return;
    await tree.end(); // string payload
    await tree.end(); // Str
    str = false;
  };
  const field = async () => {
    await openCell();
    await closeString();
    if (plain) {await tree.end(); await tree.end(); plain = false;}
    await tree.end(); // cell blocks
    await tree.end(); // cell
    cell = false;
    column++;
  };
  await replay({
    async text(text) {
      await openCell();
      if (!plain) {
        await tree.begin("object");
        await tree.key("t"); await tree.value("Plain");
        await tree.key("c"); await tree.begin("array");
        plain = true;
      }
      let fragment = "";
      for (const char of text) {
        if (char === " " || char === "\n") {
          if (fragment) {await tree.text(fragment); fragment = "";}
          await closeString();
          await tree.value({t: char === " " ? "Space" : "LineBreak"});
        } else {
          if (!str) {
            await tree.begin("object");
            await tree.key("t"); await tree.value("Str");
            await tree.key("c"); await tree.begin("string");
            str = true;
          }
          fragment += char;
        }
      }
      if (fragment) await tree.text(fragment);
    },
    field,
    async record() {
      while (column < width) await field();
      await tree.end(); // cells
      await tree.end(); // row
      if (!row) {
        await tree.end(); // head rows
        await tree.end(); // head
        await tree.begin("array"); // bodies
        await tree.begin("array"); // body
        await tree.value(attr); await tree.value(0); await tree.value([]);
        await tree.begin("array"); // body rows
      }
      row++;
      column = 0;
    }
  });
  await tree.end(); // body rows
  await tree.end(); // body
  await tree.end(); // bodies
  await tree.value([attr, []]); // foot
  await tree.end(); // table payload
  await tree.end(); // Table
}
