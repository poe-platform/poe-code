export interface ExifMetadata {
  readonly orientation?: number;
  readonly density?: number;
}
export interface MetadataRead {readonly position:number;readonly length:number;}

/** Binary metadata requests stay small even when offsets point across large chunks. */
export function* exifMetadataSteps(size:number,base=0):Generator<MetadataRead,ExifMetadata,Uint8Array> {
  let offset=0;
  if(size>=6) {
    const prefix=yield {position:base,length:6};
    if(prefix[0]===69 && prefix[1]===120 && prefix[2]===105 && prefix[3]===102 && prefix[4]===0 && prefix[5]===0)offset=6;
  }
  if(size<offset+8)return {};
  const header=yield {position:base+offset,length:8};
  const little=header[0]===73 && header[1]===73,big=header[0]===77 && header[1]===77;
  if(!little && !big)return {};
  const view=new DataView(header.buffer,header.byteOffset,header.byteLength);
  if(view.getUint16(2,little)!==42)return {};
  const ifd=view.getUint32(4,little),length=size-offset,start=base+offset;
  if(ifd+2>length)return {};
  const countBytes=yield {position:start+ifd,length:2};
  const count=new DataView(countBytes.buffer,countBytes.byteOffset,countBytes.byteLength).getUint16(0,little);
  let orientation:number|undefined,xRes:number|undefined,unit=2;
  for(let i=0;i<count;i++) {
    const position=ifd+2+i*12;if(position+12>length)break;
    const bytes=yield {position:start+position,length:12};
    const entry=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const tag=entry.getUint16(0,little),type=entry.getUint16(2,little),valueOffset=entry.getUint32(8,little);
    if(tag===0x0112) {
      const value=type===3?entry.getUint16(8,little):valueOffset;
      if(value>=1 && value<=8)orientation=value;
    } else if(tag===0x0128) {
      const value=type===3?entry.getUint16(8,little):valueOffset;
      if(value===2 || value===3)unit=value;
    } else if(tag===0x011a && type===5 && valueOffset+8<=length) {
      const bytes=yield {position:start+valueOffset,length:8};
      const ratio=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),den=ratio.getUint32(4,little);
      if(den>0)xRes=ratio.getUint32(0,little)/den;
    }
  }
  const density=xRes!==undefined && xRes>0?Math.round(xRes*(unit===3?2.54:1)):undefined;
  return {...(orientation===undefined?{}:{orientation}),...(density===undefined?{}:{density})};
}
