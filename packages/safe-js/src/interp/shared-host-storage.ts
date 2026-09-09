import type { Budget } from "./budget.js";
import { cloneSandboxValue, type SandboxValue } from "./values.js";
import { sharedArrayBufferStorage } from "./shared-array-buffer.js";

const grow=Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,"grow")?.value;

export function restoreSharedHostValue(
  value: SandboxValue,
  bindings: ReadonlyArray<{source:SharedArrayBuffer;target:SharedArrayBuffer;write?:boolean}>,
  budget?: Budget
): SandboxValue {
  const replacements=new WeakMap<object,SharedArrayBuffer>();
  const targets=new Set<object>();
  let growth=0;
  const writes=bindings.flatMap(({source,target,write=true})=>{
    const saved=sharedArrayBufferStorage(source);
    const current=sharedArrayBufferStorage(target);
    if (saved.growable!==current.growable || saved.maxByteLength!==current.maxByteLength ||
        (write&&saved.byteLength<current.byteLength) || replacements.has(saved.block) || targets.has(current.block))
      throw new TypeError("Invalid shared host storage association.");
    budget?.allocateArrayLength(saved.maxByteLength);
    replacements.set(saved.block,target);
    targets.add(current.block);
    if (!write) return [];
    growth+=saved.byteLength-current.byteLength;
    return [{target,length:saved.byteLength,previousLength:current.byteLength,bytes:new Uint8Array(source).slice()}];
  });
  // Validate the complete graph before any current-run storage is changed.
  cloneSandboxValue(value,{sharedBufferSnapshots:new WeakMap()});
  budget?.provisionDataUsage(growth)();
  for (const write of writes) {
    if (write.length!==write.previousLength) Reflect.apply(grow,write.target,[write.length]);
    new Uint8Array(write.target).set(write.bytes);
  }
  return cloneSandboxValue(value,{sharedBufferSnapshots:replacements});
}
