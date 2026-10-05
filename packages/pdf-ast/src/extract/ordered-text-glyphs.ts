import type {PdfPlacedGlyph,PdfPixelStorage} from '../ast.js';
import type {PdfIndexStorage} from '../cos/object-index.js';
import {readStoredRecord,writeStoredRecord} from '../content/stored-record.js';
import {glyphDirection,mergeBBox,textGlyphVisible} from './text-glyphs.js';
import {glyphText,sameReplacement,type PdfTextGlyph} from './stored-text-glyphs.js';
import {PdfTextRecordOrder,type PdfTextRecordOrderOptions} from './text-record-order.js';
import type {ExtractTextOptions} from './text.js';
export type PdfOrderedTextGlyph = PdfTextGlyph & {readonly lineStart:boolean};
/** Normalize before sorting, retain UTF-16 code units without decoding lone
 * surrogates, and order each geometric line separately. No glyph/line array is
 * collected. The caller keeps record storage alive through the last yield. */
export async function* orderedTextGlyphs(input:Iterable<PdfPlacedGlyph>|AsyncIterable<PdfPlacedGlyph>,backing:PdfPixelStorage,storage:PdfIndexStorage,
  options:ExtractTextOptions&PdfTextRecordOrderOptions={}):AsyncGenerator<PdfOrderedTextGlyph,void,void>{
  const signal=options.signal??new AbortController().signal,buffer=new Uint8Array(4096),view=new DataView(buffer.buffer);
  async function* records(){
    let pending:PdfPlacedGlyph|undefined,work=0;
    async function* stage(glyph:PdfPlacedGlyph){
      let prefix='';for await(const text of glyphText(glyph,signal)){prefix+=text.slice(0,2-prefix.length);if(prefix.length===2)break;}
      if(!textGlyphVisible({...glyph,unicode:prefix},options))return;
      const start=backing.allocate(0);let length=0;
      for await(const text of glyphText(glyph,signal))for(let at=0;at<text.length;at+=2048){signal.throwIfAborted();const size=Math.min(2048,text.length-at),position=backing.allocate(size*2);for(let i=0;i<size;i++)view.setUint16(i*2,text.charCodeAt(at+i));await backing.write(position,buffer.subarray(0,size*2),{signal});length+=size*2;}
      const value:PdfTextGlyph={unicode:prefix,charCode:glyph.charCode,bbox:[...glyph.bbox],baselineY:glyph.baselineY,advanceWidth:glyph.advanceWidth,matrix:[...glyph.matrix],fontSize:glyph.fontSize,fontName:'',color:{r:0,g:0,b:0},storedUnicode:{position:start,byteLength:length,storage:backing}};
      yield await writeStoredRecord(backing,value,-1,signal);
    }
    for await(const original of input){signal.throwIfAborted();if(++work%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
      const glyph:PdfPlacedGlyph={unicode:original.unicode,charCode:original.charCode,bbox:[...original.bbox],baselineY:original.baselineY,advanceWidth:original.advanceWidth,matrix:[...original.matrix],fontSize:original.fontSize,fontName:'',color:{r:0,g:0,b:0},
        ...(original.actualText!==undefined?{actualText:original.actualText}:{}),...(original.storedActualText?{storedActualText:{...original.storedActualText}}:{}),...(original.mcid!==undefined?{mcid:original.mcid}:{}),...(original.clipRect?{clipRect:[...original.clipRect]}:{})};
      if(pending&&pending.mcid===glyph.mcid&&await sameReplacement(pending,glyph,signal)){pending={...pending,bbox:mergeBBox(pending.bbox,glyph.bbox),advanceWidth:pending.advanceWidth+glyph.advanceWidth};continue;}
      if(pending)yield* stage(pending);pending=undefined;
      if(glyph.actualText!==undefined||glyph.storedActualText)pending=glyph;else yield* stage(glyph);
    }
    if(pending)yield* stage(pending);
  }
  async function read(position:number){return (await readStoredRecord<PdfTextGlyph>(backing,position,signal)).value;}
  const global=await PdfTextRecordOrder.create(records(),async(left,right)=>{
    const a=await read(left),b=await read(right),da=glyphDirection(a),db=glyphDirection(b),tol=Math.max(a.fontSize,b.fontSize)*0.45;
    if(da.ux*db.ux+da.uy*db.uy>0.85){const dn=db.normal-da.normal;return Math.abs(dn)>tol?dn:da.along-db.along;}
    const dy=b.baselineY-a.baselineY;return Math.abs(dy)>tol?dy:a.bbox[0]-b.bbox[0];
  },storage,options);
  const cursor=global.values();let failed=false;
  try{
    let next=await cursor.next(),pending=next.done?undefined:{position:next.value,glyph:await read(next.value)};
    while(pending){const reference=pending.glyph,first=glyphDirection(reference);
      async function* group(){while(pending){const current=glyphDirection(pending.glyph);if(!(first.ux*current.ux+first.uy*current.uy>0.85&&Math.abs(current.normal-first.normal)<=Math.max(reference.fontSize,pending.glyph.fontSize)*0.45))break;yield pending.position;next=await cursor.next();pending=next.done?undefined:{position:next.value,glyph:await read(next.value)};}}
      const line=await PdfTextRecordOrder.create(group(),async(left,right)=>glyphDirection(await read(left)).along-glyphDirection(await read(right)).along,storage,options);let lineFailed=false;
      try{let previous:PdfTextGlyph|undefined;for await(const position of line.values()){const glyph=await read(position),gap=previous?glyphDirection(glyph).along-glyphDirection(previous).along-previous.advanceWidth:0;
        const split=previous&&options.mode!=='bbox'&&gap>Math.max(previous.fontSize,glyph.fontSize)*4*(options.colSpacing!==undefined&&options.colSpacing>0?options.colSpacing/0.7:1);
        yield {...glyph,lineStart:!previous||!!split};previous=glyph;
      }}catch(error){lineFailed=true;throw error;}finally{await line.close().catch(error=>{if(!lineFailed)throw error;});}
    }
  }catch(error){failed=true;throw error;}finally{const results=await Promise.allSettled([cursor.return(),global.close()]);if(!failed)for(const result of results)if(result.status==='rejected')await Promise.reject(result.reason);}
}
