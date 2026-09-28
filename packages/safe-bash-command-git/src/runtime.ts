import { wasmBytes } from './wasm.generated.js';
let module: object | undefined;
const wasm = (globalThis as unknown as { WebAssembly: { Module: new (bytes: ArrayBuffer) => object } }).WebAssembly;
export function gitModule(): object { return module ??= new wasm.Module(wasmBytes().buffer as ArrayBuffer); }
