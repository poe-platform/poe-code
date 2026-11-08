import { expect, it } from "vitest";
import { Document, WD_STYLE_TYPE } from "./index.js";

it("provides original default styles for paragraph character and table model owners", async () => {
  const document = await Document();
  expect(document.styles.default(WD_STYLE_TYPE.PARAGRAPH)?.name).toBe("Normal");
  expect(document.styles.default(WD_STYLE_TYPE.CHARACTER)?.name).toBe("Default Paragraph Font");
  expect(document.styles.default(WD_STYLE_TYPE.TABLE)?.name).toBe("Normal Table");
  expect(document.add_paragraph().add_run().style?.name).toBe("Default Paragraph Font");
  expect(document.add_table(1, 1).style?.name).toBe("Normal Table");
});
