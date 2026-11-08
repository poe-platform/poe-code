import { fixture } from './validation.js';
import { storedArchive } from './archive.js';
export function membershipFixture(kind: 'sections' | 'shows', mode = 'plain', name = 'Group 😀 &amp; text', showId = '0001', memberCount = 1) {
  if (mode === 'max-id') showId = '4294967295';
  if (mode === 'overflow-id') showId = '4294967296';
  if (mode === 'zero-id') showId = '0000';
  const volume = fixture(), s = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
  const id = kind === 'sections' ? '{01234567-89ab-cdef-0123-456789abcdef}' : showId;
  const entry = kind === 'sections' ? `<s:section id="${mode === 'bad-id' ? 'invalid' : id}"${mode === 'missing-name' ? '' : ` name="${name}"`}><s:sldIdLst><s:sldId id="${mode === 'missing-slide' ? '999' : '256'}"/>${mode === 'repeated-slide' ? '<s:sldId id="256"/>' : ''}</s:sldIdLst></s:section>` : `<p:custShow id="${mode === 'bad-id' ? 'invalid' : id}"${mode === 'missing-name' ? '' : ` name="${name}"`}><p:sldLst><p:sld r:id="${mode === 'missing-slide' ? 'missing' : 'slide'}"/>${mode === 'repeated-slide' ? '<p:sld r:id="slide"/>' : ''}</p:sldLst></p:custShow>`;
  const second = kind === 'shows' ? entry.replace(`id="${id}"`, 'id="2"') : entry.replace(id, '{01234567-89ab-cdef-0123-456789abcdee}').replace('<s:sldId id="256"/>', '');
  const contents = mode === 'empty' ? '' : entry + (mode === 'duplicate' ? entry : mode === 'multiple' ? second : '') + (mode === 'foreign' ? '<foreign xmlns="urn:foreign"/>' : '');
  let list = kind === 'sections' ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><s:sectionLst xmlns:s="${s}">${contents}</s:sectionLst></p:ext></p:extLst>` : `<p:custShowLst>${contents}</p:custShowLst>`;
  if (mode === 'missing-members') list = list.split(kind === 'sections' ? 's:sldIdLst' : 'p:sldLst').join('p:other');
  if (kind === 'sections' && mode === 'extension-identity') list = list.replace('{521415D9-36F7-43E2-AB2F-B90AF26B5E84}', 'other');
  if (kind === 'sections' && mode === 'extension-content') list = list.replace('</p:ext>', '<foreign xmlns="urn:foreign"/></p:ext>');
  if (kind === 'sections' && mode === 'member-attributes') list = list.replace('<s:sldIdLst>', '<s:sldIdLst extra="value">');
  if (kind === 'shows' && memberCount !== 1) list = list.replace('<p:sld r:id="slide"/>', '<p:sld r:id="slide"/>'.repeat(memberCount));
  const source = volume.readFileSync('/deck/main.xml', 'utf8') as string;
  volume.writeFileSync('/deck/main.xml', source.replace('</p:presentation>', (mode === 'absent' ? '' : list) + '</p:presentation>'));
  if (mode === 'strict') for (const [path, text] of Object.entries(volume.toJSON())) volume.writeFileSync(path, text!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  return { volume, bytes: storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(text!) }))) };
}
