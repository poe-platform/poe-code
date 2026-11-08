import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { runQpdfCli } from "./index.js";

it("yields PDF object work and cancels without publishing output under frozen clocks", async () => {
  const doc = PdfDocument.create();
  for (let i = 0; i < 40; i++) doc.addPage();
  const files = new Map([["in.pdf", doc.save()]]);
  mock.method(performance, "now", () => 0);
  mock.method(Date, "now", () => 0);
  try {
    const controller = new AbortController();
    let turns = 0;
    registerYieldCheckpoint(controller.signal, () => {
      if (++turns === 4) setTimeout(() => controller.abort(new Error("cancel objects")), 0);
    });
    await assert.rejects(runQpdfCli(["in.pdf", "out.pdf"], files, undefined, controller.signal), /cancel objects/);
    assert.ok(turns >= 4);
    assert.equal(files.has("out.pdf"), false);
  } finally { mock.restoreAll(); }
});

import {
  cosArray, cosDict, cosName, cosNumber, cosString, dictSet,
  encryptCosDocumentSteps, generateDocumentFormAppearancesSteps, serializeCosDocumentSteps
} from "@poe-code/pdf-ast";
import { runWork } from "./work.js";

for (const stage of ["clone", "serialize", "encrypt", "forms"] as const) {
  it(`cancels PDF ${stage} at object work quanta under frozen clocks`, async () => {
    const doc = PdfDocument.create();
    for (let i = 0; i < 40; i++) doc.addPage();
    if (stage === "forms") {
      const fields = Array.from({ length: 40 }, (_, i) => doc.cos.allocateObject(cosDict({
        FT: cosName("Tx"), T: cosString(`field${i}`), V: cosString("value"),
        Rect: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(20)])
      })));
      dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray(fields) }));
    }
    mock.method(performance, "now", () => 0);
    mock.method(Date, "now", () => 0);
    try {
      const controller = new AbortController();
      let turns = 0;
      registerYieldCheckpoint(controller.signal, () => {
        // Cancel at the checkpoint: a zero-delay timer can run after short work completes.
        if (++turns === 3) controller.abort(new Error("cancel objects"));
      });
      const work: Generator<void, unknown, void> = stage === "clone"
        ? PdfDocument.create().copyPagesFromSteps(doc, Array.from({ length: 40 }, (_, i) => i))
        : stage === "serialize"
          ? serializeCosDocumentSteps({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef })
          : stage === "encrypt" ? encryptCosDocumentSteps(doc.cos)
            : generateDocumentFormAppearancesSteps(doc.cos);
      await assert.rejects(runWork(work, controller.signal), /cancel objects/);
      assert.ok(turns >= 3);
    } finally { mock.restoreAll(); }
  });
}
