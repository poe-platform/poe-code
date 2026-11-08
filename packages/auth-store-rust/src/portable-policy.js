import module from "#auth-store-portable-module";
const native = new WebAssembly.Instance(module).exports;
const serialize = JSON.stringify, deserialize = JSON.parse;

// Only primitive records cross the WASM boundary; host objects and callbacks stay here.
export function policy(operation, value = null) {
  const source = serialize(value);
  const pointer = native.credential_alloc(source.length);
  try {
    const input = new Uint16Array(native.memory.buffer, pointer, source.length);
    for (let index = 0; index < source.length; index++) input[index] = source.charCodeAt(index);
    const outputPointer = native.credential_run(operation, pointer, source.length);
    const output = new Uint16Array(native.memory.buffer, outputPointer, native.credential_result_length());
    let serialized = "";
    for (let offset = 0; offset < output.length; offset += 8192) serialized += String.fromCharCode(...output.subarray(offset, offset + 8192));
    const result = deserialize(serialized);
    if (Object.hasOwn(result, "error")) throw new Error(result.error);
    return result.value;
  } finally {
    native.credential_free(pointer, source.length);
  }
}
