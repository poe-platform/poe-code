import {expect,it} from "vitest";
import {Volume} from "memfs";
import * as api from "./index.js";
import {textContext,textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

for(const strict of [false,true])for(const carrier of ['direct','choice','fallback','process'])
for(const limit of ['tableRows','tableCells'] as const)
it(`native row append preflights ${limit} without mutating model or handles; ${carrier}; strict=${strict}`,async()=>{
 const attrs='xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:row-budget" mc:Ignorable="f" mc:ProcessContent="f:pass"',inert='<f:inert stamp="retained"/>',wrap=(s:string)=>carrier==='direct'?s:carrier==='process'?`<f:pass>${s}</f:pass>`:`<mc:AlternateContent><mc:Choice Requires="${carrier==='choice'?'w':'f'}">${carrier==='choice'?s:inert}</mc:Choice><mc:Fallback>${carrier==='fallback'?s:inert}</mc:Fallback></mc:AlternateContent>`;
 const cell=(s:string)=>`<w:tc><w:tcPr><w:tcW w:w="720" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${s}</w:t></w:r></w:p></w:tc>`,row=(s:string)=>`<w:tr><!--row--><?owner keep?>${cell(s)}${cell('Sea é 海')}</w:tr>`;
 const input=await textFixture(`<w:tbl ${attrs}><w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="720"/></w:tblGrid>${wrap(row('First'))}${wrap(row('Second'))}</w:tbl>`,{},strict),doc=await api.Document(input,{...textContext,budget:new api.DocumentBudget({[limit]:limit==='tableRows'?2:4})}),table=doc.tables[0]!,owner=table.cell(0,0),before=doc.element.serialize();
 expect(()=>table.add_row()).toThrow(expect.objectContaining({code:'limit-exceeded'}));
 expect(doc.element.serialize()).toEqual(before);expect(table.rows.length).toBe(2);expect(owner.text).toBe('First');expect(owner.element).toBe(table.cell(0,0).element);
 const v=Volume.fromJSON({'/out':''});await doc.save({async write(b){v.appendFileSync('/out',b);}});const after=readPackage(new Uint8Array(v.readFileSync('/out') as Buffer));for(const[p,b]of readPackage(input))expect(after.get(p),p).toEqual(b);
});
