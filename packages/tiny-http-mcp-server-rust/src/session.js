import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const {NativeHttpSessionStore}=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export function defaultSessionIdGenerator(){return randomUUID();}
export function createSessionStore(){
 const native=new NativeHttpSessionStore(),retained=new Map();
 return {
  create(id){
   const session={id,initialized:false,createdAt:new Date(),lastSeenAt:new Date()};
   const insertion=native.insert(id);if(insertion.previous!==null)retained.delete(insertion.previous);
   retained.set(insertion.slot,session);return session;
  },
  get(id){return retained.get(native.get(id));},
  has(id){return native.get(id)!==null;},
  delete(id){const slot=native.delete(id);return slot!==null&&retained.delete(slot);},
  touch(id){const session=retained.get(native.get(id));if(session!==undefined)session.lastSeenAt=new Date();},
  *entries(){let sequence;while(true){const entry=native.nextAfter(sequence);if(entry===null)return;sequence=entry.sequence;yield retained.get(entry.slot);}}
 };
}
