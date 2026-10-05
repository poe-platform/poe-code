import type {PdfPathSegment,PdfStoredPath} from "../ast.js";
import {readStoredPath} from "../content/stored-path.js";
import {PdfError} from "../errors.js";

/** Shared with the buffered renderer so coordinate transforms and numeric
 * spelling remain identical for resident and retained paths. */
export function svgPathSegment(segment:PdfPathSegment,height:number,matrix?:readonly number[]):string|undefined{
 const point=(x:number,y:number)=>matrix?`${matrix[0]!*x+matrix[2]!*y+matrix[4]!} ${height-matrix[1]!*x-matrix[3]!*y-matrix[5]!}`:`${x} ${height-y}`;
 switch(segment.kind){
  case "move":return `M ${point(segment.x,segment.y)}`;
  case "line":return `L ${point(segment.x,segment.y)}`;
  case "cubic":return `C ${point(segment.x1,segment.y1)} ${point(segment.x2,segment.y2)} ${point(segment.x,segment.y)}`;
  case "rect":return matrix?`M ${point(segment.x,segment.y)} L ${point(segment.x+segment.width,segment.y)} L ${point(segment.x+segment.width,segment.y+segment.height)} L ${point(segment.x,segment.y+segment.height)} Z`:`M ${segment.x} ${height-segment.y} h ${segment.width} v ${-segment.height} h ${-segment.width} Z`;
  case "close":return "Z";
 }
}
export interface PdfSvgPathOptions{
 readonly matrix?:readonly number[];
 readonly chunkBytes?:number;
 readonly maxSegments?:number;
 readonly maxOutputBytes?:number;
 readonly signal?:AbortSignal;
}
function limit(value:number|undefined):number{if(value===undefined||value===Infinity)return Infinity;if(!Number.isSafeInteger(value)||value<0)throw new RangeError("Invalid SVG path limit");return value;}
/** Stream an SVG d attribute from segments or caller-backed path records.
 * The source remains caller-owned. Retention is one record block, one segment's
 * numeric text and at most 16 KiB of output, independent of path length. */
export async function* encodeSvgPathDataChunks(input:Iterable<PdfPathSegment>|AsyncIterable<PdfPathSegment>|PdfStoredPath,height:number,options:PdfSvgPathOptions={}):AsyncGenerator<Uint8Array,void,void>{
 const {signal}=options;signal?.throwIfAborted();const chunkBytes=options.chunkBytes??16384,maxSegments=limit(options.maxSegments),maximum=limit(options.maxOutputBytes);
 if(!Number.isSafeInteger(chunkBytes)||chunkBytes<1)throw new RangeError("Invalid SVG path chunk size");
 const stored="kind" in input&&input.kind==="stored-path"?input:undefined;
 if(stored&&(!Number.isSafeInteger(stored.count)||stored.count<0))throw new RangeError("Invalid stored SVG path count");
 if(stored&&stored.count>maxSegments)throw new PdfError("E_LIMIT","SVG path segment limit exceeded");
 const source=stored?readStoredPath(stored,signal):input as Iterable<PdfPathSegment>|AsyncIterable<PdfPathSegment>;
 const buffer=new Uint8Array(Math.min(16384,chunkBytes)),encoder=new TextEncoder();let used=0,count=0,total=0,first=true;
 for await(const segment of source){
  signal?.throwIfAborted();if(count>=maxSegments)throw new PdfError("E_LIMIT","SVG path segment limit exceeded");if(++count%64===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
  const part=svgPathSegment(segment,height,options.matrix);if(part===undefined)continue;
  const text=(first?"":" ")+part;first=false;
  if(text.length>maximum-total||!Number.isSafeInteger(total+text.length))throw new PdfError("E_LIMIT","SVG path output byte limit exceeded");total+=text.length;
  const bytes=encoder.encode(text);for(let at=0;at<bytes.length;){signal?.throwIfAborted();const take=Math.min(buffer.length-used,bytes.length-at);buffer.set(bytes.subarray(at,at+take),used);used+=take;at+=take;if(used===buffer.length){yield buffer.slice();used=0;}}
 }
 signal?.throwIfAborted();if(used)yield buffer.slice(0,used);
}
