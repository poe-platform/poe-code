import { fixture, xml, ct, r } from './validation.js';
import { storedArchive } from './archive.js';
export function tagFixture(mode = 'plain', name = 'Key😀', value = 'Value &amp; text') {
  if (mode === 'empty') { name = ''; value = ''; }
  const volume = fixture();
  const edit = (part: string, transform: (xml: string) => string) => volume.writeFileSync('/deck/' + part, transform(volume.readFileSync('/deck/' + part, 'utf8') as string));
  for (const [part, target] of [['slide.xml', 'tags.xml'], ['main.xml', 'presentation-tags.xml']] as const) {
    const insertion = `<p:custDataLst><p:tags r:id="tag-rel"/></p:custDataLst>`;
    edit(part, source => source.replace(part === 'slide.xml' ? '</p:cSld>' : '</p:presentation>', insertion + (part === 'slide.xml' ? '</p:cSld>' : '</p:presentation>')));
    edit('_rels/' + part + '.rels', source => source.replace('</Relationships>', `<Relationship Id="tag-rel" Type="${r}/tags" Target="${target}"/></Relationships>`));
    volume.writeFileSync('/deck/' + target, xml(mode === 'invalid-root' ? 'wrong' : 'tagLst', `<foreign xmlns="urn:foreign"/><p:tag name="${name}"${mode === 'missing-value' ? '' : ` val="${value}"`}/>${mode === 'duplicate' ? '<p:tag name="Second" val="Two"/>' : ''}`));
    edit('[Content_Types].xml', source => source.replace('</Types>', `<Override PartName="/${target}" ContentType="${ct}tags+xml"/></Types>`));
  }
  if (mode === 'absent') edit('slide.xml', source => source.replace('<p:custDataLst><p:tags r:id="tag-rel"/></p:custDataLst>', ''));
  if (mode === 'strict') for (const [path, text] of Object.entries(volume.toJSON())) volume.writeFileSync(path, text!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(text!) })));
  return { volume, bytes };
}
