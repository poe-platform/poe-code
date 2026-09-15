import {parseDocumentXml,type XmlElement} from './package-xml.js';
import {DocumentBudget} from './budget.js';
import {DocumentXmlEditor,UnsupportedEditError} from './xml-write.js';
import type {EquationIssue} from './equations.js';
const xml='http://www.w3.org/XML/1998/namespace',xmlns='http://www.w3.org/2000/xmlns/';
export const mathNamespace=(strict:boolean)=>strict?'http://purl.oclc.org/ooxml/officeDocument/math':'http://schemas.openxmlformats.org/officeDocument/2006/math';
const expressions=['r','f','m','sSub'];
function normalized(value:string):string{let start=0,end=value.length;while(start<end&&' \t\r\n'.includes(value[start]!))start++;while(end>start&&' \t\r\n'.includes(value[end-1]!))end--;return value.slice(start,end);}
const leaves:Readonly<Record<string,{attribute:string;required?:boolean;values?:readonly string[];min?:number;max?:number}>>={type:{attribute:'val',required:true,values:['bar','skw','lin','noBar']},argSz:{attribute:'val',required:true,min:-2,max:2},jc:{attribute:'val',values:['left','right','center','centerGroup']},scr:{attribute:'val',values:['roman','script','fraktur','double-struck','sans-serif','monospace']},sty:{attribute:'val',values:['p','b','i','bi']},lit:{attribute:'val',values:['true','false','1','0','on','off']},nor:{attribute:'val',values:['true','false','1','0','on','off']},aln:{attribute:'val',values:['true','false','1','0','on','off']},brk:{attribute:'alnAt',min:1,max:255}};
function integer(value:string,min:number,max:number):boolean {const s=normalized(value);let i=s[0]==='+'||s[0]==='-'?1:0;if(i===s.length)return false;for(;i<s.length;i++)if(!'0123456789'.includes(s[i]!))return false;const n=Number(s);return Number.isSafeInteger(n)&&n>=min&&n<=max;}
/** Checks the closed inert fragment grammar, independently of paragraph authority. */
export function inspectEquationFragment(root:XmlElement,namespace:string,budget:DocumentBudget,part='',base:readonly number[]=[]):EquationIssue[]{
 const issues:EquationIssue[]=[];
 const issue=(path:readonly number[])=>{budget.charge('diagnosticBytes',160+part.length+path.length*8);budget.charge('retainedBytes',256+path.length*8);issues.push({code:'opaque-equation-fragment',part,path:[...path],message:'Stored math is outside the bounded equation fragment grammar.'});};
 const visit=(node:XmlElement,path:readonly number[])=>{
  budget.charge('work',1+node.attributes.length+node.content.length);let valid=node.namespace===namespace;
  const names=node.children.map(n=>n.localName),optional=(property:string,allowed:readonly string[],minimum=0)=>{const offset=names[0]===property?1:0;return names.length-offset>=minimum&&names.slice(offset).every(n=>allowed.includes(n));},exact=(property:string,children:readonly string[])=>{const offset=names[0]===property?1:0;return names.slice(offset).length===children.length&&children.every((n,i)=>names[i+offset]===n);};
  if(node.localName==='oMath')valid&&=names.every(n=>expressions.includes(n));
  else if(node.localName==='oMathPara')valid&&=optional('oMathParaPr',['oMath'],1);
  else if(node.localName==='r')valid&&=optional('rPr',['t']);
  else if(node.localName==='f')valid&&=exact('fPr',['num','den']);
  else if(node.localName==='m')valid&&=optional('mPr',['mr'],1);
  else if(node.localName==='mr')valid&&=names.length>0&&names.every(n=>n==='e');
  else if(node.localName==='sSub')valid&&=exact('sSubPr',['e','sub']);
  else if(['num','den','e','sub'].includes(node.localName))valid&&=optional('argPr',expressions);
  else if(['mPr','sSubPr','t'].includes(node.localName))valid&&=names.length===0;
  else if(['argPr','fPr','oMathParaPr'].includes(node.localName)){const child={argPr:'argSz',fPr:'type',oMathParaPr:'jc'}[node.localName]!;valid&&=names.length<=1&&names.every(n=>n===child);}
  else if(node.localName==='rPr'){const order=['lit','nor','scr','sty','brk','aln'];let previous=-1;valid&&=!names.includes('nor')||!names.some(n=>['scr','sty'].includes(n));for(const n of names){const index=order.indexOf(n);if(index<=previous)valid=false;previous=index;}}
  else if(leaves[node.localName])valid&&=names.length===0;
  else valid=false;
  for(const content of node.content){if(content.kind==='element')continue;if(content.kind!=='text'&&content.kind!=='cdata')valid=false;else if(node.localName!=='t'&&normalized(content.text))valid=false;}
  for(const attribute of node.attributes){budget.charge('work',attribute.value.length);if(attribute.namespace===xmlns){if(attribute.value!==namespace&&attribute.value!==xml)valid=false;continue;}if(node.localName==='t'&&attribute.namespace===xml&&attribute.localName==='space'&&['default','preserve'].includes(attribute.value))continue;const leaf=leaves[node.localName];if(!leaf||attribute.namespace!==namespace||attribute.localName!==leaf.attribute)valid=false;else if(leaf.values){const value=['lit','nor','aln'].includes(node.localName)?normalized(attribute.value):attribute.value;if(!leaf.values.includes(value)||namespace===mathNamespace(true)&&['on','off'].includes(value))valid=false;}else if(!integer(attribute.value,leaf.min!,leaf.max!))valid=false;}
  const leaf=leaves[node.localName];if(leaf?.required&&!node.attributes.some(a=>a.namespace===namespace&&a.localName===leaf.attribute))valid=false;
  if(!valid)issue(path);node.children.forEach((child,i)=>visit(child,[...path,i]));
 };
 if(root.namespace!==namespace||!['oMath','oMathPara'].includes(root.localName))issue(base);
 visit(root,base);return issues;
}
/** Admits original explicit math input, retaining only its standalone root bytes. */
export function admitEquationFragment(bytes:Uint8Array,namespace:string,budget:DocumentBudget):{root:XmlElement;xml:string}{
 const parsed=parseDocumentXml(bytes,{},budget),root=parsed.root;
 const framing=[...(root.prolog??[]),...(root.epilog??[])];
 if(framing.some(n=>n.kind!=='text'&&!(n.kind==='processing-instruction'&&'target' in n&&n.target==='xml')||n.kind==='text'&&normalized(n.text))||inspectEquationFragment(root,namespace,budget).length)throw new UnsupportedEditError('Equation fragment is outside the bounded grammar.');
 const editor=new DocumentXmlEditor(bytes,{},undefined,budget);return {root,xml:editor.sourceXml(editor.root)};
}
