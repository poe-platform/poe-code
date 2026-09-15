import { expect, it } from 'vitest';
import { parseDocumentXml } from './package-xml.js';
import { DocumentBudget } from './budget.js';
import { collectShapeCarriers } from './shape-carriers.js';
import { box, officeShapeNamespace } from '../tests/fixtures/shapes.js';
import { w } from '../tests/fixtures/text.js';
const census = (source: string) => collectShapeCarriers(parseDocumentXml(new TextEncoder().encode(source)).root, 'transitional', new DocumentBudget(), new Map());
it.each(['office', 'vml', 'native'] as const)('admits unique %s body with native ownership', kind => {
  const result = census(box(undefined, kind));
  expect(result.carriers).toHaveLength(1);
  expect(result.carriers[0]!.bodies).toHaveLength(1);
  expect(result.carriers[0]!.support).toBe('supported');
});
it('foreign wrappers never acquire shape authority', () => {
 expect(census(`<w:p xmlns:w="${w}"><w:r><w:drawing><x:wsp xmlns:x="urn:foreign"><w:txbxContent><w:p/></w:txbxContent></x:wsp></w:drawing></w:r></w:p>`).carriers).toHaveLength(0);
});
it('multiple bodies retain boundaries but admit no stories', () => {
 const source = box().replace('</s:txbx>', '<w:txbxContent><w:p/></w:txbxContent></s:txbx>');
 const result = census(source);
 expect(result.carriers[0]!.bodies).toHaveLength(0);
 expect(result.bodyRoots.size).toBe(2);
 expect(result.carriers[0]!.refusalReasons).toContain('multiple-bodies');
});
it('raw inactive flow evidence guards the active source', () => {
 const source = box().replace('<s:txbx>', '<s:txbx id="7">').replace('</w:drawing>', `<s:wsp xmlns:s="${officeShapeNamespace}"><s:linkedTxbx id="7" seq="1"/></s:wsp></w:drawing>`);
 expect(census(source).carriers[0]!.refusalReasons).toContain('linked-flow');
});
it('foreign envelope descendants confer no native authority', () => {
 const source=box().replace('<s:wsp','<x:payload xmlns:x="urn:foreign"><s:wsp').replace('</s:wsp>','</s:wsp></x:payload>');
 expect(census(source).carriers.filter(c=>c.support==='supported')).toHaveLength(0);
});
it('foreign textbox wrappers confer no editable body', () => {
 const source=box().replace('<s:txbx>','<x:payload xmlns:x="urn:foreign"><s:txbx>').replace('</s:txbx>','</s:txbx></x:payload>');
 expect(census(source).carriers[0]!.bodies).toHaveLength(0);
 expect(census(source).carriers[0]!.refusalReasons.length).toBeGreaterThan(0);
});
it('cross drawing linked flow guards the source while independent defaults do not', () => {
 const linked=box().replace('<s:txbx>','<s:txbx id="7">')+box().replace('<s:txbx><w:txbxContent><w:p><w:r><w:t>coast</w:t></w:r></w:p></w:txbxContent></s:txbx>','<s:linkedTxbx id="7" seq="1"/>');
 expect(census(`<w:body xmlns:w="${w}">${linked}</w:body>`).carriers[0]!.refusalReasons).toContain('linked-flow');
 expect(census(`<w:body xmlns:w="${w}">${box()}${box()}</w:body>`).carriers.every(c=>c.support==='supported')).toBe(true);
});
it('known drawing resource wrappers confer no shape authority',()=>{
 const source=box().replace('<s:wsp','<a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><s:wsp').replace('</s:wsp>','</s:wsp></a:blip>');
 expect(census(source).carriers[0]!.support).toBe('preserve-only');
});
