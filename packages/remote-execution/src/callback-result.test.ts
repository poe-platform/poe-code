import {expect, it} from 'vitest';
import {validateCallbackResult} from './callback-result.js';
import type {CallbackResult, FileOperation} from './wire.generated.js';

const result:CallbackResult={type:'CallbackResult',callbackId:'callback',operationId:'operation',state:'applied'};
const stat={type:'file' as const,size:0,mode:0,mtimeMs:0,atimeMs:0,ctimeMs:0};
const error={category:'filesystem' as const,code:'EIO',message:'I/O failed',phase:'accepted' as const};
it.each([
 [{op:'open',path:'/x',rights:['read'],flag:'r'},{}],
 [{op:'stat',handleId:'h'},{}],
 [{op:'seek',handleId:'h',whence:'set',offset:'0'},{}],
 [{op:'readlink',path:'/x'},{}],
 [{op:'readdir',path:'/',maxEntries:1},{}],
 [{op:'read',handleId:'h',length:'4',channelId:4},{}],
 [{op:'write',handleId:'h',length:'4',channelId:4},{acknowledgedBytes:'5'}],
 [{op:'stat',handleId:'h'},{stat,acknowledgedBytes:'1'}],
 [{op:'close',handleId:'h'},{handleId:'replacement'}],
 [{op:'readdir',path:'/',maxEntries:0},{entries:[{name:'x',type:'file'}]}],
] as const)('rejects a result that contradicts its originating operation %j', (operation,fields)=>{
 expect(()=>validateCallbackResult(operation as FileOperation,{...result,...fields} as CallbackResult)).toThrow();
});
it.each([
 [{op:'open',path:'/x',rights:['read'],flag:'r'},{handleId:'h'}],
 [{op:'stat',handleId:'h'},{stat}],
 [{op:'seek',handleId:'h',whence:'set',offset:'0'},{position:'0'}],
 [{op:'readlink',path:'/x'},{target:''}],
 [{op:'readdir',path:'/',maxEntries:0},{entries:[]}],
 [{op:'read',handleId:'h',length:'4',channelId:4},{acknowledgedBytes:'0'}],
 [{op:'write',handleId:'h',length:'4',channelId:4},{acknowledgedBytes:'3'}],
 [{op:'close',handleId:'h'},{}],
] as const)('accepts exact operation results and short I/O %j',(operation,fields)=>{
 expect(()=>validateCallbackResult(operation as FileOperation,{...result,...fields} as CallbackResult)).not.toThrow();
});
it('retains failed partial I/O while refusing impossible progress',()=>{
 const operation:FileOperation={op:'write',handleId:'h',length:'4',channelId:4};
 expect(()=>validateCallbackResult(operation,{...result,state:'failed',acknowledgedBytes:'3',error})).not.toThrow();
 expect(()=>validateCallbackResult(operation,{...result,state:'unknown',acknowledgedBytes:'5'})).toThrow();
 expect(()=>validateCallbackResult({op:'stat',path:'/x'},{...result,state:'failed',error})).not.toThrow();
});
it('requires symbolic failure and unknown-outcome recovery instead of contradictory success',()=>{
 const operation:FileOperation={op:'close',handleId:'h'};
 for(const fields of [{state:'failed'},{state:'unknown'},{state:'unknown',error},{state:'applied',error},{state:'failed',error:{...error,code:''}}]){
  expect(()=>validateCallbackResult(operation,{...result,...fields} as CallbackResult)).toThrow();
 }
 expect(()=>validateCallbackResult(operation,{...result,state:'unknown',error:{...error,phase:'unknown',recovery:{sessionId:'session',epoch:'epoch',operationId:'operation'}}})).not.toThrow();
});
