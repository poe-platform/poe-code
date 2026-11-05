import { type3WordOrder, type Type3Word, type Type3OrderReply } from "./type3-word-order.js";
import type {PdfPixelStorage} from '../ast.js';
import type {PdfIndexStorage} from '../cos/object-index.js';
import {appendStoredRecord,readStoredRecord} from '../content/stored-record.js';
import {textDirection,sameTextLine,PdfTextGlyphOrder,mergeBBox,textGlyphVisible} from './text-glyphs.js';
import {glyphText,glyphFontName,sameReplacement,type PdfTextGlyph} from './stored-text-glyphs.js';
import {PdfTextRecordOrder,type PdfTextRecordOrderOptions} from './text-record-order.js';
import type {ExtractTextOptions} from './text.js';
export type PdfOrderedTextGlyph = PdfTextGlyph & {readonly lineStart:boolean;readonly wordStart?:boolean};
/** Normalize before sorting, retain UTF-16 code units without decoding lone
 * surrogates, and order each geometric line separately. No glyph/line array is
 * collected. The caller keeps record storage alive through the last yield. */
export async function* orderedTextGlyphs(input:Iterable<PdfTextGlyph>|AsyncIterable<PdfTextGlyph>,backing:PdfPixelStorage,storage:PdfIndexStorage,
  options:ExtractTextOptions&PdfTextRecordOrderOptions&{readonly retainFontNames?:boolean}={}):AsyncGenerator<PdfOrderedTextGlyph,void,void>{
  const signal=options.signal??new AbortController().signal,buffer=new Uint8Array(4096),view=new DataView(buffer.buffer);
  const order = new PdfTextGlyphOrder();
  let firstRecord=-1,lastRecord=-1,type3=false,horizontal=true;
  async function* records(){
    let pending:PdfTextGlyph|undefined,work=0;
    async function* stage(glyph:PdfTextGlyph){
      let prefix='';for await(const text of glyphText(glyph,signal)){prefix+=text.slice(0,2-prefix.length);if(prefix.length===2)break;}
      if(!textGlyphVisible({...glyph,unicode:prefix},options))return;
      if(textDirection(glyph).diagonal&&(prefix===' '||prefix==='\t'))return;
      async function store(parts:AsyncIterable<string>){const position=backing.allocate(0);let byteLength=0;for await(const text of parts)for(let at=0;at<text.length;at+=2048){signal.throwIfAborted();const size=Math.min(2048,text.length-at),atByte=backing.allocate(size*2);for(let i=0;i<size;i++)view.setUint16(i*2,text.charCodeAt(at+i));await backing.write(atByte,buffer.subarray(0,size*2),{signal});byteLength+=size*2;}return {position,byteLength,storage:backing};}
      const storedUnicode=await store(glyphText(glyph,signal)),storedFontName=options.retainFontNames?await store(glyphFontName(glyph,signal)):undefined;
      const value:PdfTextGlyph={unicode:prefix,charCode:glyph.charCode,bbox:[...glyph.bbox],baselineY:glyph.baselineY,advanceWidth:glyph.advanceWidth,matrix:[...glyph.matrix],fontSize:glyph.fontSize,...(glyph.type3FontSize!==undefined?{type3FontSize:glyph.type3FontSize,type3AdvanceWidth:glyph.type3AdvanceWidth}:{}),fontName:'',color:{r:0,g:0,b:0},storedUnicode,...(storedFontName?{storedFontName}:{})};
      order.observe(value);
      type3 ||= value.type3FontSize!==undefined;
      horizontal &&= value.matrix[0]>0&&value.matrix[1]===0;
      lastRecord=await appendStoredRecord(backing,value,lastRecord,signal);if(firstRecord===-1)firstRecord=lastRecord;
      yield lastRecord;
    }
    for await(const original of input){signal.throwIfAborted();if(++work%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
      const glyph:PdfTextGlyph={unicode:original.unicode,charCode:original.charCode,bbox:[...original.bbox],baselineY:original.baselineY,advanceWidth:original.advanceWidth,matrix:[...original.matrix],fontSize:original.fontSize,...(original.type3FontSize!==undefined?{type3FontSize:original.type3FontSize,type3AdvanceWidth:original.type3AdvanceWidth}:{}),fontName:options.retainFontNames?original.fontName:'',color:{r:0,g:0,b:0},
        ...(options.retainFontNames&&original.storedFontName?{storedFontName:{...original.storedFontName}}:{}),
        ...(original.actualText!==undefined?{actualText:original.actualText}:{}),...(original.storedActualText?{storedActualText:{...original.storedActualText}}:{}),...(original.mcid!==undefined?{mcid:original.mcid}:{}),...(original.clipRect?{clipRect:[...original.clipRect]}:{})};
      if(pending&&pending.mcid===glyph.mcid&&await sameReplacement(pending,glyph,signal)){pending={...pending,bbox:mergeBBox(pending.bbox,glyph.bbox),advanceWidth:pending.advanceWidth+glyph.advanceWidth};continue;}
      if(pending)yield* stage(pending);pending=undefined;
      if(glyph.actualText!==undefined||glyph.storedActualText)pending=glyph;else yield* stage(glyph);
    }
    if(pending)yield* stage(pending);
  }
  async function read(position:number){return (await readStoredRecord<PdfTextGlyph>(backing,position,signal)).value;}
  const global=await PdfTextRecordOrder.create(records(),async(left,right)=>{
    return order.compare(await read(left), await read(right));
  },storage,options);
  if(type3&&horizontal){
    let failed=false;
    try{
      const base=backing.allocate(0),buffer=new Uint8Array(72),view=new DataView(buffer.buffer);let count=0,work=0;
      const program=type3WordOrder(firstRecord,options.fixedPitch);let reply:Type3OrderReply;
      for(let step=program.next();!step.done;step=program.next(reply)){
        signal.throwIfAborted();if(++work%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
        const request=step.value;reply=undefined;
        if(request.kind==='glyph'){const record=await readStoredRecord<PdfTextGlyph>(backing,request.position,signal);reply={glyph:record.value,next:record.next};}
        else if(request.kind==='read'){
          const bytes=await backing.read(base+request.index*72,72,{signal}),data=new DataView(bytes.buffer,bytes.byteOffset,72);
          reply=Array.from({length:9},(_,i)=>data.getFloat64(i*8)) as Type3Word;
        }else if(request.kind==='write'){
          if(request.index===count){backing.allocate(72);count++;}
          request.word.forEach((value,i)=>view.setFloat64(i*8,value));await backing.write(base+request.index*72,buffer,{signal});
        }else{
          let first=true;
          for(let position=request.first;position!==request.end;){
            const record=await readStoredRecord<PdfTextGlyph>(backing,position,signal);
            yield {...record.value,lineStart:first&&request.lineStart,wordStart:first&&request.wordStart};first=false;position=record.next;
          }
        }
      }
    }catch(error){failed=true;throw error;}finally{await global.close().catch(error=>{if(!failed)throw error;});}
    return;
  }
  const cursor=global.values();let failed=false;
  try{
    let next=await cursor.next(),pending=next.done?undefined:{position:next.value,glyph:await read(next.value)};
    while(pending){const reference=pending.glyph;
      async function* group(){while(pending){if(!sameTextLine(reference,pending.glyph))break;yield pending.position;next=await cursor.next();pending=next.done?undefined:{position:next.value,glyph:await read(next.value)};}}
      const line=await PdfTextRecordOrder.create(group(),async(left,right)=>textDirection(await read(left)).along-textDirection(await read(right)).along,storage,options);let lineFailed=false;
      try{let previous:PdfTextGlyph|undefined;for await(const position of line.values()){const glyph=await read(position),gap=previous?textDirection(glyph).along-textDirection(previous).along-textDirection(previous).advance:0;
        const split=previous&&options.mode!=='bbox'&&gap>Math.max(previous.fontSize,glyph.fontSize)*4*(options.colSpacing!==undefined&&options.colSpacing>0?options.colSpacing/0.7:1);
        yield {...glyph,lineStart:!previous||!!split};previous=glyph;
      }}catch(error){lineFailed=true;throw error;}finally{await line.close().catch(error=>{if(!lineFailed)throw error;});}
    }
  }catch(error){failed=true;throw error;}finally{const results=await Promise.allSettled([cursor.return(),global.close()]);if(!failed)for(const result of results)if(result.status==='rejected')await Promise.reject(result.reason);}
}
