import type {PdfPixelStorage,PdfRect} from '../ast.js';
import type {PdfIndexStorage} from '../cos/object-index.js';
import {appendStoredRecord,readStoredRecord,writeStoredRecord} from '../content/stored-record.js';
import {mergeBBox} from './text-glyphs.js';
import {PdfTextRecordOrder,type PdfTextRecordOrderOptions} from './text-record-order.js';
import type {PdfOrderedTextGlyph} from './ordered-text-glyphs.js';
interface Line {first:number;bbox:PdfRect;baseline:number}
/** Delay column choice until every line is classified, retaining only counters
 * and one line's geometry. Glyph chains and the stable line order use backing. */
export async function* logicalTextGlyphs(input:AsyncIterable<PdfOrderedTextGlyph>,backing:PdfPixelStorage,storage:PdfIndexStorage,pageWidth:number,options:PdfTextRecordOrderOptions={}):AsyncGenerator<PdfOrderedTextGlyph,void,void>{
  let left=0,right=0,total=0;
  const midpoint=pageWidth/2;
  const column=(box:PdfRect)=>box[2]<=midpoint+18?0:box[0]>=midpoint-18?1:2;
  async function* lines(){
    let first=-1,last=-1,box:PdfRect|undefined,baseline=0;
    async function finish(){if(!box)return undefined;total++;const side=column(box);if(side===0)left++;else if(side===1)right++;return writeStoredRecord(backing,{first,bbox:box,baseline},-1,options.signal);}
    for await(const glyph of input){
      options.signal?.throwIfAborted();
      if(glyph.lineStart){const position=await finish();if(position!==undefined)yield position;first=last=-1;box=undefined;baseline=glyph.baselineY;}
      last=await appendStoredRecord(backing,glyph,last,options.signal);if(first===-1)first=last;
      if(glyph.unicode!==' '&&glyph.unicode!=='\t')box=box?mergeBBox(box,glyph.bbox):[...glyph.bbox];
    }
    const position=await finish();if(position!==undefined)yield position;
  }
  const order=await PdfTextRecordOrder.create(lines(),async(a,b)=>{
    if(total<=2||!left||!right||left+right!==total)return a-b;
    const x=(await readStoredRecord<Line>(backing,a,options.signal)).value,y=(await readStoredRecord<Line>(backing,b,options.signal)).value;
    return column(x.bbox)-column(y.bbox)||y.baseline-x.baseline;
  },storage,options);
  let failed=false;
  try{for await(const position of order.values()){
    const line=(await readStoredRecord<Line>(backing,position,options.signal)).value;
    let at=line.first,work=0;
    while(at!==-1){if(++work%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));options.signal?.throwIfAborted();const record=await readStoredRecord<PdfOrderedTextGlyph>(backing,at,options.signal);yield record.value;at=record.next;}
  }}catch(error){failed=true;throw error;}finally{await order.close().catch(error=>{if(!failed)throw error;});}
}
