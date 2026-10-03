import {FsError,type FileSystem} from 'safe-bash-contracts';
import {CsvBudget,CsvParser} from 'safe-bash-csv-engine';
import {createPrivateSqliteStorage,withPrivateSqliteSession,withSqliteStatement} from 'safe-bash-sqlite-engine/storage';
import {createLlmSpool} from './retained-spool.js';
import {embeddingText} from './embed-input.js';
import type {LlmCollectionBatchEntry} from './collections-batch.js';
import {sniffCsvInput} from './import-csv-sniff.js';

/** Header order and field ranges live in caller-backed SQLite. Payloads never
 * enter SQLite scalar bindings or accumulate in complete JavaScript rows. */
export async function withCsvEmbeddingEntries<T>(options:{
 readonly fs:FileSystem;readonly directory:string;readonly signal:AbortSignal;
 readonly maxFileBytes:number;readonly maxOpenFiles:number;
 readonly tabs?:boolean;readonly autoDetect?:boolean;readonly prefix?:string;readonly prepend?:string;
},input:AsyncIterable<Uint8Array>,operation:(entries:AsyncIterable<LlmCollectionBatchEntry>)=>Promise<T>):Promise<T>{
 const {fs,directory,signal}=options;
 const detected=options.autoDetect?await sniffCsvInput(input,signal):undefined;
 let storage:Awaited<ReturnType<typeof createPrivateSqliteStorage>>|undefined;
 try{
  storage=await createPrivateSqliteStorage({...options,maxFiles:options.maxOpenFiles});
  return await withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/fields'},async session=>{
  await session.execute('CREATE TABLE headers(name TEXT PRIMARY KEY,first INTEGER UNIQUE,last INTEGER); CREATE TABLE fields(position INTEGER PRIMARY KEY,start INTEGER,end INTEGER)');
  const budget=new CsvBudget({},signal),encoder=new TextEncoder();
  type Event={text:string}|{field:true}|{row:true};let events:Event[]=[];
  const parser=new CsvParser(detected?.dialect??{tabs:options.tabs??false},budget,{text:text=>events.push({text}),field:()=>events.push({field:true}),row:()=>events.push({row:true})});
  let header=true,name='',column=0,columns=0,start=0,size=0;
  let spool:Awaited<ReturnType<typeof createLlmSpool>>|undefined;
  const query=async(sql:string,bindings:readonly (string|number)[])=>withSqliteStatement(session.module,{...session,signal,sql},async statement=>{for await(const ignored of statement.rows(bindings,[])){signal.throwIfAborted();}});
  async function* drain():AsyncGenerator<LlmCollectionBatchEntry>{
   const pending=events;events=[];
   for(const event of pending){
    signal.throwIfAborted();
    if('text'in event){
     if(header){name+=event.text;if(encoder.encode(name).length>65536)throw new RangeError('CSV header exceeds SQLite control byte limit');}
     else{spool??=await createLlmSpool(fs,directory,signal,'input');const bytes=encoder.encode(event.text);await spool.write(bytes);size+=bytes.length;}
    }else if('field'in event){
     if(header){await query('INSERT INTO headers(name,first,last) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET last=excluded.last',[name,column,column]);name='';}
     else await query('INSERT INTO fields(position,start,end) VALUES(?,?,?)',[column,start,size]);
     column++;start=size;
    }else{
     if(header){header=false;columns=column;column=0;continue;}
     if(!column)continue;
     if(column>columns)throw new Error('CSV row contains extra values');
     spool??=await createLlmSpool(fs,directory,signal,'input');
     const owned=spool;let active=true,consumed=false;
     try{
      let id='None';
      await withSqliteStatement(session.module,{...session,signal,sql:'SELECT coalesce(fields.start,-1),coalesce(fields.end,-1) FROM headers LEFT JOIN fields ON fields.position=headers.last ORDER BY headers.first LIMIT 1'},async statement=>{
       for await(const [from,to]of statement.rows([],['integer','integer'])){
        if(from===-1n)continue;
        if(Number(to)-Number(from)>65536)throw new RangeError('Embedding ID exceeds SQLite control byte limit');
        const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});id='';
        for await(const bytes of owned.replay(async()=>({start:Number(from),end:Number(to)})))id+=decoder.decode(bytes,{stream:true});id+=decoder.decode();
       }
      });
      yield {id:(options.prefix??'')+id,input:{async dispose(){active=false;},bytes:{async *[Symbol.asyncIterator](){
       if(!active||consumed)throw new FsError('EBADF',{message:'CSV row lease is closed'});consumed=true;
       if(options.prepend)for(let offset=0;offset<options.prepend.length;){if(!active)throw new FsError('EBADF',{message:'CSV row lease is closed'});signal.throwIfAborted();let end=Math.min(offset+4096,options.prepend.length);const last=options.prepend.charCodeAt(end-1);if(end<options.prepend.length&&last>=0xd800&&last<=0xdbff)end--;yield encoder.encode(options.prepend.slice(offset,end));offset=end;}
       signal.throwIfAborted();
       let first=true,position=-1,contentFields=0;
       while(true){
        let next:{position:number;start:number|null;end:number|null}|undefined;
        await withSqliteStatement(session.module,{...session,signal,sql:'SELECT headers.first,coalesce(fields.start,-1),coalesce(fields.end,-1) FROM headers LEFT JOIN fields ON fields.position=headers.last WHERE headers.first>? ORDER BY headers.first LIMIT 1'},async statement=>{
         for await(const [key,from,to]of statement.rows([position],['integer','integer','integer']))next={position:Number(key),start:from===-1n?null:Number(from),end:to===-1n?null:Number(to)};
        });
        if(!next)break;position=next.position;
        if(first){first=false;continue;}
        if(!active)throw new FsError('EBADF',{message:'CSV row lease is closed'});
        if(contentFields++)yield Uint8Array.of(32);
        if(next.start!==null)for await(const bytes of owned.replay(async()=>({start:next!.start!,end:next!.end!}))){if(!active)throw new FsError('EBADF',{message:'CSV row lease is closed'});yield bytes;}
       }
      }}}};
     }finally{active=false;await owned.close();spool=undefined;}
     await session.execute('DELETE FROM fields');column=0;size=0;start=0;
    }
   }
  }
  const entries={async *[Symbol.asyncIterator](){
   try{for await(const bytes of embeddingText(detected?.bytes??input,signal))for(let offset=0;offset<bytes.length;offset+=4096){await budget.checkpoint();parser.push(bytes.subarray(offset,offset+4096));yield* drain();}parser.end();yield* drain();}
   finally{await spool?.close();}
  }};
  const iterator=entries[Symbol.asyncIterator]();
  try{return await operation({[Symbol.asyncIterator]:()=>iterator});}finally{try{await iterator.return(undefined);}finally{parser.dispose();budget.dispose();}}
 });}finally{try{await storage?.close();}finally{await detected?.close();}}
}
