import {PagedStorage} from '@poe-code/safe-fs/storage';
import type {PdfIndexStorage} from '../cos/object-index.js';
import {PdfError} from '../errors.js';
import {sortTextRecordsSteps} from './text-sort.js';
export interface PdfTextRecordOrderOptions {
  readonly maxEntries?:number;
  /** Internal shared admission ledger; release only after backing closes. */
  readonly accountStorage?:(delta:number)=>void;
  /** Page-rounded allocation for identities and reusable merge scratch. */
  readonly maxStorageBytes?:number;
  /** Fixed page cache, scalar sort state and I/O scratch; comparator-owned data is additional. */
  readonly maxWorkingBytes?:number;
  readonly signal?:AbortSignal;
}
function limit(value:number|undefined){if(value===undefined||value===Infinity)return Infinity;if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Invalid PDF text order limit');return value;}
/** Immutable order of record identities with fixed resident storage. The owner
 * keeps glyph/line records elsewhere; the comparator may read those records on
 * demand. Both the primary order and merge scratch use caller-authorized backing. */
export class PdfTextRecordOrder {
  private readonly backing:PagedStorage;
  private readonly signal:AbortSignal;
  private readonly buffer=new Uint8Array(8);
  private count=0;
  private allocated=8;
  private charged=0;
  private temporary=0;
  private closed=false;
  private closing:Promise<void>|undefined;
  private constructor(storage:PdfIndexStorage,private readonly options:PdfTextRecordOrderOptions){this.signal=options.signal??new AbortController().signal;this.backing=new PagedStorage({fs:storage.fs,cwd:storage.directory,env:{},signal:this.signal},4);}
  static async create(input:Iterable<number>|AsyncIterable<number>,compare:(left:number,right:number)=>Promise<number>|number,storage:PdfIndexStorage,options:PdfTextRecordOrderOptions={}):Promise<PdfTextRecordOrder>{
    for(const n of [options.maxEntries,options.maxStorageBytes,options.maxWorkingBytes])limit(n);
    options.signal?.throwIfAborted();if(limit(options.maxWorkingBytes)<81920)throw new PdfError('E_LIMIT','PDF text order working byte limit exceeded');
    const result=new PdfTextRecordOrder(storage,options);
    try{
      for await(const value of input){result.assertOpen();if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Invalid PDF text record identity');if(result.count>=limit(options.maxEntries))throw new PdfError('E_LIMIT','PDF text record count limit exceeded');
        const position=result.allocate(8);await result.write(position,value);result.count++;if(result.count%256===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      if(result.count>1)result.temporary=result.allocate(Math.floor(result.count/2)*8);
      const program=sortTextRecordsSteps(result.count);let next=program.next(),work=0;
      try{while(!next.done){result.assertOpen();if(++work%1024===0){await new Promise<void>(resolve=>setTimeout(resolve,0));result.assertOpen();}const request=next.value;let reply=0;
        if(request.kind==='compare')reply=await compare(request.left,request.right);
        else{const max=request.temporary?Math.floor(result.count/2):result.count;if(!Number.isSafeInteger(request.index)||request.index<0||request.index>=max)throw new RangeError('Invalid PDF sort cursor');const position=(request.temporary?result.temporary:8)+request.index*8;
          if(request.kind==='read')reply=await result.read(position);else await result.write(position,request.value);
        }
        result.assertOpen();next=program.next(reply);
      }}finally{program.return();}
      return result;
    }catch(error){await result.close().catch(()=>{});throw error;}
  }
  private assertOpen(){this.signal.throwIfAborted();if(this.closed)throw new PdfError('E_CAPABILITY','PDF text order is closed');}
  private allocate(bytes:number){const end=this.allocated+bytes;if(!Number.isSafeInteger(end)||Math.ceil(end/16384)*16384>limit(this.options.maxStorageBytes))throw new PdfError('E_LIMIT','PDF text order storage byte limit exceeded');const charge=Math.ceil(end/16384)*16384;this.options.accountStorage?.(charge-this.charged);this.charged=charge;const position=this.backing.allocate(bytes);this.allocated=end;return position;}
  private async write(position:number,value:number){new DataView(this.buffer.buffer).setFloat64(0,value);await this.backing.write(position,this.buffer);}
  private async read(position:number){const bytes=await this.backing.read(position,8);return new DataView(bytes.buffer,bytes.byteOffset,8).getFloat64(0);}
  async *values():AsyncGenerator<number,void,void>{for(let i=0;i<this.count;i++){this.assertOpen();if(i&&i%256===0)await new Promise<void>(resolve=>setTimeout(resolve,0));yield await this.read(8+i*8);}this.assertOpen();}
  close():Promise<void>{this.closed=true;return this.closing??=this.backing.close().then(()=>{this.options.accountStorage?.(-this.charged);this.charged=0;});}
}
