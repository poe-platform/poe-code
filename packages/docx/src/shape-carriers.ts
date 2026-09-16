import type { DocumentBudget } from './budget.js';
import { documentDialects, type DocumentDialect } from './dialect.js';
import type { XmlElement } from './package-xml.js';
export interface ShapeBody { readonly node: XmlElement; readonly wordNamespace: string }
export interface ShapeCarrier {
 readonly node: XmlElement; readonly kind: 'shape' | 'group'; readonly representation: 'native' | 'office' | 'vml';
 readonly group: XmlElement | null; readonly bodies: readonly ShapeBody[]; readonly refusalReasons: readonly string[];
 readonly active: boolean; readonly opaque: boolean; readonly support: 'supported' | 'preserve-only';
}
export interface ShapeCarrierCensus { readonly carriers: readonly ShapeCarrier[]; readonly rawCarriers: readonly ShapeCarrier[]; readonly bodyRoots: ReadonlySet<XmlElement> }
const officeShape = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const officeGroup = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const vml = 'urn:schemas-microsoft-com:vml';
const wordExtension = 'http://schemas.microsoft.com/office/word/2006/wordml';
const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
/** Expanded names and owner-local ancestry confer authority, never labels or equal text. */
export function collectShapeCarriers(root: XmlElement, dialect: DocumentDialect, budget: DocumentBudget,
 branches: ReadonlyMap<XmlElement, XmlElement | undefined>): ShapeCarrierCensus {
 const vocabulary = documentDialects[dialect];
 const bodyRoots = new Set<XmlElement>();
 const records: { node: XmlElement; kind: 'shape' | 'group'; representation: 'native' | 'office' | 'vml'; group: XmlElement | null; bodies: ShapeBody[]; refusalReasons: string[]; active: boolean; opaque: boolean; support: 'supported' | 'preserve-only'; owner: XmlElement; links: string[]; ids: string[]; ancestors: XmlElement[] }[] = [];
 const attr = (n: XmlElement, name: string) => n.attributes.find(a => !a.namespace && a.localName === name)?.value;
 const visit = (node: XmlElement, owner: XmlElement | undefined, group: XmlElement | null, canvas: boolean, active: boolean, ancestors: XmlElement[]) => {
  budget.charge('work', ancestors.length + 1); budget.charge('retainedBytes', 32 + ancestors.length * 8);
  if (node.namespace === vocabulary.w && ['drawing','pict'].includes(node.localName)) { owner = node; group = null; canvas = false; }
  if (node.namespace === vocabulary.wp && node.localName === 'wpc' && owner) canvas = true;
  let representation: 'native' | 'office' | 'vml' | undefined;
  let kind: 'shape' | 'group' = 'shape';
  if (owner && node.namespace === vocabulary.wp && ['wsp','wgp','grpSp'].includes(node.localName)) { representation = 'native'; kind = node.localName === 'wsp' ? 'shape' : 'group'; }
  if (owner && node.namespace === officeShape && node.localName === 'wsp') representation = 'office';
  if (owner && node.namespace === officeGroup && ['wgp','grpSp'].includes(node.localName)) { representation = 'office'; kind = 'group'; }
  if (owner && node.namespace === vml && ['shape','arc','curve','line','oval','polyline','rect','roundrect','group'].includes(node.localName)) { representation = 'vml'; kind = node.localName === 'group' ? 'group' : 'shape'; }
  if (representation) {
   const candidates: XmlElement[] = [], admitted = new Set<XmlElement>(), links: string[] = [], ids: string[] = [];
   const enclosing = ancestors.slice(ancestors.indexOf(owner!)+1);
   const foreignEnvelope = enclosing.some(n => !(n.namespace===vocabulary.wp && ['inline','anchor','wpc','wgp','grpSp'].includes(n.localName) || n.namespace===vocabulary.a && ['graphic','graphicData'].includes(n.localName) || n.namespace===officeGroup && ['wgp','grpSp'].includes(n.localName) || n.namespace===vml && n.localName==='group' || n.namespace===mc && ['AlternateContent','Choice','Fallback'].includes(n.localName)));
   const scan = (n: XmlElement, parents: XmlElement[] = []) => {
    budget.charge('work', 1);
    if (n !== node && ((n.namespace === vocabulary.wp && ['wsp','wgp','grpSp'].includes(n.localName)) || n.namespace === officeShape && n.localName === 'wsp' || n.namespace === officeGroup || n.namespace === vml && ['shape','group'].includes(n.localName))) return;
    if (n.localName === 'txbxContent' && [vocabulary.wp, vocabulary.w, documentDialects.transitional.w, wordExtension].includes(n.namespace)) { candidates.push(n); const parent=parents.at(-1), grandparent=parents.at(-2);
     if (parent && grandparent === node && (representation === 'native' ? parent.namespace===vocabulary.wp && parent.localName==='txbx' && n.namespace===vocabulary.wp : representation === 'office' ? parent.namespace===officeShape && parent.localName==='txbx' && n.namespace===documentDialects.transitional.w : parent.namespace===vml && parent.localName==='textbox' && n.namespace===documentDialects.transitional.w)) admitted.add(n); }
    if (n.localName === 'linkedTxbx' && [vocabulary.wp,officeShape].includes(n.namespace)) links.push(attr(n,'id') ?? '');
    if (n.localName === 'txbx' && [vocabulary.wp,officeShape].includes(n.namespace)) ids.push(attr(n,'id') ?? '0');
    for (const child of n.children) scan(child,[...parents,n]);
   }; scan(node);
   candidates.forEach(n => bodyRoots.add(n));
   const reasons: string[] = [];
   if (foreignEnvelope) reasons.push('foreign-envelope');
   if (candidates.some(n=>!admitted.has(n))) reasons.push('unsupported-body');
   if (group) reasons.push('group-contained');
   if (canvas) reasons.push('canvas');
   if (candidates.length > 1) reasons.push('multiple-bodies');
   if (candidates.some(n => n.namespace === wordExtension)) reasons.push('opaque-body');
   if (dialect === 'strict' && representation !== 'native') reasons.push('strict-extension');
   const expected = representation === 'native' ? vocabulary.wp : documentDialects.transitional.w;
   const bodies = candidates.length === 1 && candidates[0]!.namespace === expected && admitted.has(candidates[0]!) && !reasons.includes('strict-extension') && !foreignEnvelope ? [{node:candidates[0]!,wordNamespace:representation === 'native' ? vocabulary.w : documentDialects.transitional.w}] : [];
   if (candidates.length && !bodies.length && !reasons.length) reasons.push('unsupported-body');
   const style = attr(node,'style') ?? '';
   for (const declaration of style.split(';')) { const colon = declaration.indexOf(':'); if (colon >= 0 && declaration.slice(0,colon).trim().toLowerCase() === 'mso-next-textbox' && declaration.slice(colon + 1).trim()) links.push('vml-flow'); }
   if (links.length) reasons.push('linked-flow');
   records.push({node,kind,representation,group,bodies,refusalReasons:reasons,active,opaque:!!candidates.length && !bodies.length,support:reasons.length || kind === 'group' ? 'preserve-only' : 'supported',owner:[...ancestors].reverse().find(n=>['body','hdr','ftr','footnote','endnote','comment','txbxContent'].includes(n.localName)&&(n.namespace===vocabulary.w||n.namespace===vocabulary.wp))??root,links,ids,ancestors});
   if (kind === 'group') group = node;
  }
  for (const child of node.children) {
   const selected = node.namespace === mc && node.localName === 'AlternateContent' ? branches.get(node) : undefined;
   visit(child,owner,group,canvas,active && (!(node.namespace === mc && node.localName === 'AlternateContent') || selected === child),[...ancestors,node]);
  }
 }; visit(root,undefined,null,false,true,[]);
 for (const record of records) {
  for (const other of records) {
   budget.charge('work', 1);
   if (record.owner === other.owner && other.links.some(id => record.ids.includes(id))) { if (!record.refusalReasons.includes('linked-flow')) record.refusalReasons.push('linked-flow'); }
   if (other !== record && other.bodies.some(body => record.ancestors.includes(body.node))) {
    if (!record.refusalReasons.includes('nested-box')) record.refusalReasons.push('nested-box');
    if (!other.refusalReasons.includes('containing-box')) other.refusalReasons.push('containing-box');
   }
  }
  record.support = record.refusalReasons.length || record.kind === 'group' ? 'preserve-only' : 'supported';
 }
 return {carriers:records.filter(r => r.active),rawCarriers:records,bodyRoots};
}
