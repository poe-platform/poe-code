import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { formatPdfNumber, cosString, encodeWinAnsiBytes, serializeCosNodeBytes } from "@poe-code/pdf-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { RetainedOfficeBlocks } from "./retained-office-blocks.js";
import { RetainedPdf } from "./retained-pdf-storage.js";
import { retainPdfImage } from "./retained-pdf-image.js";
import type { SofficeSnapshot } from "./retained-input.js";

/** Fixed-width scalar records; all variable-length presentation state is backed. */
export class SlideRecords {
  private readonly index: IntegerTable;
  count = 0;
  constructor(private readonly storage: PagedStorage, private readonly fields: number) { this.index = new IntegerTable(storage); }
  async add(values: readonly number[]): Promise<void> {
    if (values.length !== this.fields) throw new Error("Invalid slide record");
    const bytes = new Uint8Array(this.fields * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value));
    const position = this.storage.allocate(bytes.length); await this.storage.write(position, bytes);
    await this.index.set(BigInt(this.count++), BigInt(position));
  }
  async get(index: number): Promise<number[]> {
    const bytes = await this.storage.read(Number(await this.index.get(BigInt(index))), this.fields * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: this.fields}, (_, field) => view.getFloat64(field * 8));
  }
}
export class RetainedSlide {
  readonly paragraphs: SlideRecords;
  readonly boxes: SlideRecords;
  readonly images: SlideRecords;
  readonly tables: SlideRecords;
  readonly cells: RetainedOfficeBlocks;
  constructor(storage: PagedStorage, signal: AbortSignal) {
    this.paragraphs = new SlideRecords(storage, 2); this.boxes = new SlideRecords(storage, 6);
    this.images = new SlideRecords(storage, 6); this.tables = new SlideRecords(storage, 4);
    this.cells = new RetainedOfficeBlocks(storage, signal);
  }
}

export async function renderRetainedSlide(pdf: RetainedPdf, storage: PagedStorage, slide: RetainedSlide, signal: AbortSignal): Promise<void> {
  const encoder = new TextEncoder();
  async function* read(position: number, size: number) {
    for (let offset = 0; offset < size; offset += 16384) { signal.throwIfAborted(); yield new Uint8Array(await storage.read(position + offset, Math.min(16384, size - offset))); }
  }
  const text = async (chunks: AsyncIterable<Uint8Array>, x: number, y: number, size: number, heading: boolean, color: string, prefix = "") => {
    await pdf.append(`q\n${color} rg\nBT\n/${heading ? "Heading" : "Body"} ${formatPdfNumber(size)} Tf\n1 0 0 1 ${formatPdfNumber(x!)} ${formatPdfNumber(y)} Tm\n`);
    if (prefix) { await pdf.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(prefix)))); await pdf.append(" Tj\n"); }
    const decoder = new TextDecoder("utf-8", {ignoreBOM: true});
    for await (const bytes of chunks) {
      const value = decoder.decode(bytes, {stream: true});
      if (value) { await pdf.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(value)))); await pdf.append(" Tj\n"); }
    }
    const tail = decoder.decode(); if (tail) { await pdf.append(serializeCosNodeBytes(cosString(encodeWinAnsiBytes(tail)))); await pdf.append(" Tj\n"); }
    await pdf.append("ET\nQ\n");
  };
  const wrap = async (span: SofficeSnapshot, maximum: number, x: number, startY: number, size: number, lineHeight: number, clip: boolean) => {
    const words = new SlideRecords(storage, 3), decoder = new TextDecoder("utf-8", {ignoreBOM:true});
    let position = 0, start = 0, bytes = 0, units = 0;
    const finish = async () => {if (bytes) await words.add([start,bytes,units]); bytes = 0; units = 0;};
    const scan = async (value: string) => { for (const char of value) {const length=encoder.encode(char).length;if (!char.trim()) await finish();else {if (!bytes)start=position;bytes+=length;units+=char.length;}position+=length;} };
    for await (const chunk of read(span.position,span.size)) {await scan(decoder.decode(chunk,{stream:true}));await yieldTurn(signal);}await scan(decoder.decode());await finish();
    let first=0,y=startY,line=0;
    do {
      let end=first,length=0;
      while(end<words.count){const next=(await words.get(end))[2]!;if(end>first&&length+1+next>maximum)break;length+=(end>first?1:0)+next;end++;}
      async function* chunks(){for(let word=first;word<end;word++){if(word>first)yield Uint8Array.of(32);const [offset,size]=await words.get(word);yield* read(span.position+offset!,size!);}}
      if(!clip||y>=14){await text(chunks(),x,y,size,false,"0.18 0.2 0.24",line===0?"- ":"  ");y-=lineHeight;}
      first=end;line++;await yieldTurn(signal);
    }while(first<words.count);
    return y;
  };
  await pdf.append("q\n0.12 0.22 0.38 rg\n0 345 720 60 re\nf\nQ\n");
  const [titlePosition,titleSize]=await slide.paragraphs.get(0);
  await text(read(titlePosition!,titleSize!),40,365,22,true,"1 1 1");
  for(let index=0;index<slide.images.count;index++){
    const [position,size,x,y,width,height]=await slide.images.get(index), image=await retainPdfImage(storage,{position:position!,size:size!,width:width!,height:height!},signal);
    if(image)await pdf.image(image,{x:x!,y:y!,width:width!,height:height!});
  }
  let cursorY=330,previousX:number|undefined;
  if(slide.boxes.count){
    for(let index=0;index<slide.boxes.count;index++){
      const [first,count,x,topY,width,fontSize]=await slide.boxes.get(index);let y=previousX!==undefined&&Math.abs(x!-previousX)<40?Math.min(topY!,cursorY):topY!;previousX=x;
      for(let paragraph=first!;paragraph<first!+count!;paragraph++){const [position,size]=await slide.paragraphs.get(paragraph);y=await wrap({position:position!,size:size!},Math.max(24,Math.floor(width!/(fontSize!*0.52))),x!,y,fontSize!,Math.round(fontSize!*1.35),true);y-=4;}
      cursorY=y-4;
    }
  }else if(!slide.tables.count){
    let y=300;for(let index=1;index<slide.paragraphs.count;index++){const [position,size]=await slide.paragraphs.get(index);y=await wrap({position:position!,size:size!},78,52,y,14,20,false);y-=6;}
  }
  for(let index=0;index<slide.tables.count;index++){
    const [block,x,topY,width]=await slide.tables.get(index),table=(await slide.cells.table(slide.cells.snapshot(),block!))!,cellWidth=width!/table.columns;let rowTop=Math.min(topY!,cursorY);
    for(let row=0;row<table.rows;row++){
      const bottom=rowTop-22;if(bottom<14)break;
      await pdf.append(row===0?`q\n0.92 0.94 0.97 rg\n0.5 0.55 0.62 RG\n0.75 w\n${formatPdfNumber(x!)} ${formatPdfNumber(bottom)} ${formatPdfNumber(width!)} 22 re\nB\nQ\n`:`q\n0.7 0.72 0.75 RG\n0.5 w\n${formatPdfNumber(x!)} ${formatPdfNumber(bottom)} ${formatPdfNumber(width!)} 22 re\nS\nQ\n`);
      for(let cell=0,count=await table.cells(row);cell<count;cell++){
        const left=x!+cell*cellWidth;
        if(cell)await pdf.append(`q\n0.7 0.72 0.75 RG\n0.5 w\n${formatPdfNumber(left)} ${formatPdfNumber(bottom)} m\n${formatPdfNumber(left)} ${formatPdfNumber(rowTop)} l\nS\nQ\n`);
        await text(table.streamCell(row,cell),left+6,bottom+6,10,row===0,"0.15 0.15 0.15");
      }
      rowTop-=22;await yieldTurn(signal);
    }
    cursorY=rowTop-8;
  }
  await pdf.finishPage();
}
