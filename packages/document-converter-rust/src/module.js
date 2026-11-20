export async function loadWasm() {
  const {wasmBase64} = await import("./wasm.js");
  const text = atob(wasmBase64), bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
