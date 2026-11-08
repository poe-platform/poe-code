/** Keep the pinned loader's synchronous handle API while its native I/O suspends. */
export function installPythonJspiDynlib(module: any, active: {value:number}): void {
 const engine = (globalThis as any).WebAssembly;
 const load = engine.promising(module._emscripten_dlopen_promise);
 module._emscripten_dlopen_promise = (pointer:number,flags:number):number => {
  // The native JS loader restores its stack immediately after receiving a handle.
  const bytes = new TextEncoder().encode(module.UTF8ToString(pointer)+'\0');
  const owned = module._malloc(bytes.length);
  if(!owned)throw new Error('Native library pathname allocation failed');
  module.HEAPU8.set(bytes,owned);
  const promise = Promise.resolve().then(async()=>{
   const previous = active.value;
   active.value=2;
   try {
    const id = await load(owned,flags);
    const completion = module.getPromise(id);
    module.promiseMap.free(id);
    return await completion;
   } finally {active.value=previous;module._free(owned);}
  });
  return module.promiseMap.allocate({promise});
 };
}
