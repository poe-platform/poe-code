import binaryen from 'binaryen';
export function meterPythonWasm(bytes) {
const module=binaryen.readBinary(bytes);
if(module.hasMemory()) {
 const memory=module.getMemoryInfo();
 if(memory.shared||memory.is64||memory.initial>4096)throw new Error('Unsupported Python WASM memory');
 const segments=Array.from({length:module.getNumMemorySegments()},(_,index)=>{const segment=module.getMemorySegmentInfo(String(index));return {offset:module.i32.const(segment.offset??0),data:new Uint8Array(segment.data),passive:segment.passive};});
 module.setMemory(memory.initial,4096,null,segments,false,false);
}
// Charge every function entry and loop iteration. Guest Python cannot disable
// these callbacks, unlike a Python tracing function. Unknown IR fails the build.
const fields={Block:['children'],If:['condition','ifTrue','ifFalse'],Loop:['body'],Break:['condition','value'],Switch:['condition','value'],Call:['operands'],CallIndirect:['target','operands'],LocalGet:[],LocalSet:['value'],GlobalGet:[],GlobalSet:['value'],Load:['ptr'],Store:['ptr','value'],Const:[],Unary:['value'],Binary:['left','right'],Select:['ifTrue','ifFalse','condition'],Drop:['value'],Return:['value'],Nop:[],Unreachable:[],MemorySize:[],MemoryGrow:['delta'],MemoryInit:['dest','offset','size'],DataDrop:[],MemoryCopy:['dest','source','size'],MemoryFill:['dest','value','size']};
const children=new Map(Object.entries(fields).map(([name,keys])=>[binaryen[name+'Id'],keys]));
module.addFunctionImport('csvpy_work','csvpy','work',binaryen.none,binaryen.none);
const charge=()=>module.call('csvpy_work',[],binaryen.none);
function visit(ref){
 if(!ref)return;
 const info=binaryen.getExpressionInfo(ref),keys=children.get(info.id);
 if(!keys)throw new Error('Unsupported Python WASM expression '+info.id);
 for(const key of keys)for(const child of Array.isArray(info[key])?info[key]:[info[key]])visit(child);
 if(info.id===binaryen.LoopId)binaryen._BinaryenLoopSetBody(ref,module.block(null,[charge(),info.body],binaryen.getExpressionType(info.body)));
}
for(let index=0;index<module.getNumFunctions();index++){
 const fn=module.getFunctionByIndex(index),info=binaryen.getFunctionInfo(fn);
 if(!info.body)continue;
 visit(info.body);
 binaryen.Function.setBody(fn,module.block(null,[charge(),info.body],binaryen.getExpressionType(info.body)));
}
if(!module.validate())throw new Error('Invalid metered Python WASM');
const result=module.emitBinary();module.dispose();return result;
}
