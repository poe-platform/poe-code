import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

test("qpdf JSON page reports include externalized images in direct and inherited resources",async()=>{
  const {PdfDocument,cosDict,dictGet,dictSet,dictDelete}=await import("@poe-code/pdf-ast");
  for(const layout of ["direct","indirect","inherited","shared","shared-xobjects"]) {
    const doc=PdfDocument.create(),pages=[doc.addPage(),doc.addPage()];
    pages[0].setRawContentStream(Buffer.concat([Buffer.from("q BI /W 8 /H 1 /BPC 8 /CS /G ID "),Buffer.from([0,32,69,73,32,1,2,3]),Buffer.from(" EI Q\nBI /F /AHx /W 1 /H 1 /BPC 8 /CS /RGB ID FF0000> EI")]));
    dictSet(pages[1].dict,"Contents",dictGet(pages[0].dict,"Contents"));
    const resource=()=>cosDict({XObject:doc.cos.allocateObject(cosDict({}))});
    const shared=doc.cos.allocateObject(resource());
    for(const p of pages) {
      dictSet(p.dict,"Resources",layout==="direct"?resource():layout==="indirect"?doc.cos.allocateObject(resource()):layout==="shared-xobjects"?doc.cos.allocateObject(doc.cos.resolveDict(shared)):shared);
      if(layout==="inherited") {dictSet(doc.cos.resolveDict(dictGet(p.dict,"Parent")),"Resources",shared);dictDelete(p.dict,"Resources");}
    }
    const input=doc.save(),bash=new RustWasmBash({cwd:"/",files:{"/in":input}});
    try {
      for(const version of [1,2])for(const selection of ["","--json-key=pages","--json-object=1"]) {
        const result=await bash.exec("qpdf in --externalize-inline-images --ii-min-bytes=2 --json="+version+" "+selection);
        assert.equal(result.exitCode,0,result.stderr);
        const report=JSON.parse(result.stdout);assert.equal(report.pages.length,2);
        for(const page of report.pages) {
          // qpdf 12.4.2 lists both images on both pages for every layout.
          assert.deepEqual(page.images.map(i=>[i.width,i.height,i.bitspercomponent,i.colorspace]),[[8,1,8,"/DeviceGray"],[1,1,8,"/DeviceRGB"]],layout+"/"+version+"/"+selection);
          for(const image of page.images)assert.equal(typeof image.object,"string");
        }
      }
      const saved=await bash.exec("qpdf in --externalize-inline-images --ii-min-bytes=2 out.pdf");assert.equal(saved.exitCode,0,saved.stderr);
      const output=PdfDocument.load(await bash.fs.readFile("/out.pdf"));
      for(let index=0;index<2;index++)assert.equal(output.cos.resolveDict(dictGet(output.getPage(index).getResourcesDict(),"XObject")).entries.length,2,layout);
      assert.deepEqual(await bash.fs.readFile("/in"),input);
    }finally{bash.dispose();}
  }
});

test("qpdf externalization preserves each page's pixels and existing shared XObjects", async () => {
  const { PdfDocument, cosDict, cosStream, cosName, cosNumber, dictGet, dictSet, dictDelete } = await import("@poe-code/pdf-ast");
  for (const layout of ["shared", "shared-xobjects", "inherited"]) {
    const doc = PdfDocument.create();
    const pages = [doc.addPage(), doc.addPage(), doc.addPage()];
    const existingPixels = Uint8Array.of(40, 50);
    const existing = doc.cos.allocateObject(cosStream(existingPixels, { dict: cosDict({
      Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(2),
      Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceGray"),
    }) }));
    const images = doc.cos.allocateObject(cosDict({ ImExt1: existing }));
    const resources = doc.cos.allocateObject(cosDict({ XObject: images }));
    const pagePixels = [Uint8Array.of(10, 20), Uint8Array.of(70, 80)];
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      page.setRawContentStream(index < 2 ? Buffer.concat([
        Buffer.from("/ImExt1 Do\nBI /W 2 /H 1 /BPC 8 /CS /G ID "),
        pagePixels[index], Buffer.from(" EI"),
      ]) : Buffer.from("/ImExt1 Do"));
      dictSet(page.dict, "Resources", layout === "shared-xobjects"
        ? doc.cos.allocateObject(cosDict({ XObject: images })) : resources);
      if (layout === "inherited") {
        dictSet(doc.cos.resolveDict(dictGet(page.dict, "Parent")), "Resources", resources);
        dictDelete(page.dict, "Resources");
      }
    }
    const input = doc.save();
    const bash = new RustWasmBash({ cwd: "/", files: { "/in.pdf": input } });
    try {
      const result = await bash.exec("qpdf in.pdf --externalize-inline-images --ii-min-bytes=2 out.pdf");
      assert.equal(result.exitCode, 0, result.stderr);
      const output = PdfDocument.load(await bash.fs.readFile("/out.pdf"));
      for (let index = 0; index < pages.length; index++) {
        const page = output.getPage(index);
        const xobjects = output.cos.resolveDict(dictGet(page.getResourcesDict(), "XObject"));
        assert.equal(xobjects.entries.length, index < 2 ? 2 : 1, layout + "/" + index);
        const names = [...Buffer.from(page.getRawContentStream()).toString().matchAll(/\/(\w+) Do/g)].map(match => match[1]);
        assert.equal(names.length, index < 2 ? 2 : 1);
        for (let image = 0; image < names.length; image++) {
          const stream = output.cos.resolve(dictGet(xobjects, names[image]));
          assert.equal(stream.kind, "stream");
          assert.deepEqual(output.cos.decodeStream(stream), image === 0 ? existingPixels : pagePixels[index]);
        }
      }
      assert.deepEqual(await bash.fs.readFile("/in.pdf"), input);
    } finally {
      bash.dispose();
    }
  }
});
