import type {ByteSource} from 'safe-bash-contracts';
import {yieldTurn} from 'safe-bash-contracts/yield';
import {sqliteSourceChunks} from './sqlite-stream.js';
import {withSqliteStatement} from './sqlite-statement.js';
import type {PrivateSqliteSession} from './sqlite-session.js';

/** Python re's Unicode whitespace set includes the information separators and
 * excludes BOM/zero-width space. Keep at most 33 code points, not UTF-16 units. */
export async function historyConversationName(source:ByteSource,signal:AbortSignal):Promise<string>{
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 const name:string[]=[];let whitespace=false,steps=0;
 const consume=async(text:string):Promise<boolean>=>{
  for(const char of text){
   if(++steps%4096===0)await yieldTurn(signal);
   const code=char.codePointAt(0)!;
   const space=code>=9&&code<=13||code>=28&&code<=32||code===0x85||code===0xa0||code===0x1680||code>=0x2000&&code<=0x200a||code===0x2028||code===0x2029||code===0x202f||code===0x205f||code===0x3000;
   if(!space||!whitespace)name.push(space?' ':char);
   whitespace=space;
   if(name.length===33)return true;
  }
  return false;
 };
 for await(const bytes of sqliteSourceChunks(source,signal)){
  if(!(bytes instanceof Uint8Array))throw new TypeError('Conversation text must yield bytes');
  await yieldTurn(signal);
  for(let offset=0;offset<bytes.length;offset+=16384){
   signal.throwIfAborted();
   if(await consume(decoder.decode(bytes.subarray(offset,offset+16384),{stream:true})))return name.slice(0,31).join('')+'…';
  }
 }
 signal.throwIfAborted();
 if(await consume(decoder.decode()))return name.slice(0,31).join('')+'…';
 return name.join('');
}

/** The logger supplies prompt, or system when prompt is empty, or an empty
 * source. Identifiers/model controls and related response rows remain its own. */
export async function writeLlmHistoryConversation(session:PrivateSqliteSession,conversation:{readonly id:string;readonly model:string;readonly nameSource:ByteSource},signal:AbortSignal):Promise<void>{
 const {id,model,nameSource}=conversation;
 const name=await historyConversationName(nameSource,signal);
 await withSqliteStatement(session.module,{...session,signal,sql:'INSERT OR IGNORE INTO conversations(id,name,model) VALUES(?,?,?)'},async insert=>{
  for await(const unused of insert.rows([id,name,model],[]))void unused;
 });
}
