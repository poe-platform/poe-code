import { wasmBytes } from './wasm.generated.js';
let module: WebAssembly.Module | undefined;
export function gitModule(): WebAssembly.Module { return module ??=new WebAssembly.Module(wasmBytes().buffer as ArrayBuffer); }
