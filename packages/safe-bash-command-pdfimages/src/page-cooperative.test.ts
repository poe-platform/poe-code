import { afterEach, expect, test, vi } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdfimagesCli } from "./index.js";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
for (const cancel of [false, true]) {
 test(`image extraction walks pages cooperatively (cancel=${cancel})`, async () => {
  const doc=PdfDocument.create();
  for(let i=0;i<8;i++) doc.addPage([72,72]);
  const files=new Map([["in.pdf",doc.save()]]);
  vi.stubGlobal("setImmediate", undefined);
  vi.spyOn(Date,"now").mockReturnValue(0);
  vi.spyOn(performance,"now").mockReturnValue(0);
  const controller=new AbortController();
  const reason=new Error("cancel page extraction");
  const timer=globalThis.setTimeout;
  let turns=0;
  vi.spyOn(globalThis,"setTimeout").mockImplementation(((callback:()=>void,ms?:number)=>timer(()=>{
   if(++turns===5 && cancel) controller.abort(reason);
   callback();
  },ms)) as typeof setTimeout);
  const run=runPdfimagesCli(["-list","in.pdf"],files,{signal:controller.signal});
  if(cancel) await expect(run).rejects.toBe(reason);
  else {expect((await run).exitCode).toBe(0);expect(turns).toBeGreaterThanOrEqual(8);}
 });
}
