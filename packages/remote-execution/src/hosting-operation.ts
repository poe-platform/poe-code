/** Abort the caller even when an SDK or trusted resolver ignores its signal.
 * Observe late results and failures without replaying the operation. */
export async function hostingOperation<T>(signal:AbortSignal,operation:()=>Promise<T>,discard?:(value:T)=>Promise<unknown>|void):Promise<T> {
 signal.throwIfAborted();
 let abort:()=>void=()=>{};
 const cancelled=new Promise<never>((_,reject)=>{
  abort=()=>reject(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
 });
 const result=new Promise<T>(resolve=>{resolve(operation());}).then(async value=>{
  if(signal.aborted){
   try {await discard?.(value);}catch { /* Preserve the cancellation reason. */ }
   signal.throwIfAborted();
  }
  return value;
 });
 try {return await Promise.race([result,cancelled]);}
 finally {signal.removeEventListener('abort',abort);}
}
