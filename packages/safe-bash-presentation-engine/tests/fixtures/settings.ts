import { fixture, xml, ct, r } from './validation.js';
import { storedArchive } from './archive.js';
export function settingsFixture(mode = 'plain', extra = '') {
  const dimension = mode === 'numeric' ? '1e3' : mode === 'large-numeric' ? '  +' + '0'.repeat(50000) + '12192000  ' : mode === 'safe-numeric' ? '9007199254740991' : mode === 'unsafe-numeric' ? '9007199254740992' : '  +00012192000  ';
  const volume = fixture();
  const edit = (part: string, transform: (xml: string) => string) => volume.writeFileSync('/deck/' + part, transform(volume.readFileSync('/deck/' + part, 'utf8') as string));
  edit('main.xml', source => source.replace('<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>', '').replace('<p:presentation ', `<p:presentation firstSlideNum="${mode === 'numbering' ? '2147483648' : '-0'}" `).replace('</p:presentation>', `<p:sldSz cx="${dimension}" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>${mode === 'duplicate' ? '<p:sldSz/>' : ''}</p:presentation>`));
  if (mode !== 'absent') {
    for (const [part, type] of [['props.xml', 'presProps'], ['view.xml', 'viewProps']]) {
      edit('_rels/main.xml.rels', source => source.replace('</Relationships>', `<Relationship Id="${type}" Type="${r}/${type}" Target="${part}"/></Relationships>`));
      edit('[Content_Types].xml', source => source.replace('</Types>', `<Override PartName="/${part}" ContentType="${ct}${mode === 'wrong-type' ? 'tags' : type}+xml"/></Types>`));
    }
    volume.writeFileSync('/deck/props.xml', xml(mode === 'wrong-root' ? 'wrong' : 'presentationPr', `<p:showPr loop="${mode === 'loop' ? 'invalid' : ' true '}"><p:browse/>${mode === 'modes' ? '<p:kiosk/>' : ''}</p:showPr><p:prnPr xmlns:q="urn:local" q:flag="keep"${mode === 'rebound' ? ' xmlns:u="urn:override"' : ''}>${extra}</p:prnPr>`).replace('xmlns:a=', `xmlns:u="${mode === 'namespace' ? 'urn:' + 'u'.repeat(50000) : 'urn:unused&amp;value'}" xmlns:a=`));
    volume.writeFileSync('/deck/view.xml', xml('viewPr', `<p:normalViewPr/>${extra}`));
  }
  if (mode === 'strict') for (const [path, text] of Object.entries(volume.toJSON())) volume.writeFileSync(path, text!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(text!) })));
  return { volume, bytes };
}
