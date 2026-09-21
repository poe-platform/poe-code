import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, Drawing, getDocxDiscovery } from "./index.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it.each(["images.add", "images.set", "images.replace"] as const)(
  "%s help discovers supported live image models and ordered utility batches",
  async (operation) => {
    const document = await Document();
    const run = document.add_paragraph().add_run();
    await run.add_picture(rasterPng());
    const volume = Volume.fromJSON({ "/saved": "" });
    await document.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
    const reopened = await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer));
    expect(reopened.inline_shapes.length).toBe(1);
    const drawing = [...reopened.paragraphs.at(-1)!.runs[0]!.iter_inner_content()]
      .find((value) => value instanceof Drawing) as Drawing;
    expect(drawing.image.blob).toEqual(rasterPng());

    const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation } })!.human;
    expect(help).toContain("supports the admitted ordered utility batch subset");
    expect(help).not.toContain("utility batch execution remains unsupported");
    expect(help).not.toContain("Utility batch execution and live");
    expect(help).not.toContain("models remain pending");
    expect(help).not.toContain("live drawing/collection models remain unsupported");
    expect(help).toContain("docx help batch --operation model.document.Document.inline_shapes.get");
    expect(getDocxDiscovery({ operation: "schema", inputs: [], options: {
      operation: "model.document.Document.inline_shapes.get"
    } })!.data).toMatchObject({ operations: [{ support: "read" }] });
  }
);
