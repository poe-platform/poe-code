import { w, paragraph } from './text.js';
export const officeShapeNamespace = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
export function box(content = paragraph('coast'), kind: 'office' | 'vml' | 'native' = 'office', strict = false): string {
  const wp = strict ? 'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing' : 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const carrier = kind === 'vml' ? `<v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:10pt;height:20pt"><v:textbox><w:txbxContent>${content}</w:txbxContent></v:textbox></v:shape>` : kind === 'native' ? `<s:wsp xmlns:s="${wp}"><s:cNvSpPr/><s:spPr/><s:txbx><s:txbxContent>${content}</s:txbxContent></s:txbx><s:bodyPr/></s:wsp>` : `<s:wsp xmlns:s="${officeShapeNamespace}"><s:cNvSpPr/><s:spPr/><s:txbx><w:txbxContent>${content}</w:txbxContent></s:txbx><s:bodyPr/></s:wsp>`;
  return `<w:p xmlns:w="${w}"><w:r><w:${kind === 'vml' ? 'pict' : 'drawing'}>${carrier}</w:${kind === 'vml' ? 'pict' : 'drawing'}></w:r></w:p>`;
}
export function groupedNativeBox(): string {
 const wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
 return `<w:p xmlns:w="${w}"><w:r><w:drawing><s:wgp xmlns:s="${wp}"><s:wsp><s:spPr/><s:txbx><s:txbxContent><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>coast</w:t></w:r></w:p></s:txbxContent></s:txbx><s:bodyPr/></s:wsp></s:wgp></w:drawing></w:r></w:p>`;
}
