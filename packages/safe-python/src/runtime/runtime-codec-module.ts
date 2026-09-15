import type {KeyOperations} from "./ordered-key-map.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import type {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCodecRegistryFunctions} from "./runtime-codec-registry-functions.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {createRuntimeWideCodecFunctions} from "./runtime-wide-codec-functions.js";
import {createRuntimeCharmapBuild} from "./runtime-encoding-map.js";
import type {RuntimeValue,TypeValue} from "./runtime-values.js";

/** CPython 3.14.7 _codecs method-table order is visible in the live module
 * dictionary. Binding factories may group their implementations differently;
 * publication must not expose that internal assembly order to guest code. */
const nativeCodecExports = [
  "register", "unregister", "lookup", "encode", "decode",
  "escape_encode", "escape_decode",
  "utf_8_encode", "utf_8_decode", "utf_7_encode", "utf_7_decode",
  "utf_16_encode", "utf_16_le_encode", "utf_16_be_encode",
  "utf_16_decode", "utf_16_le_decode", "utf_16_be_decode", "utf_16_ex_decode",
  "utf_32_encode", "utf_32_le_encode", "utf_32_be_encode",
  "utf_32_decode", "utf_32_le_decode", "utf_32_be_decode", "utf_32_ex_decode",
  "unicode_escape_encode", "unicode_escape_decode",
  "raw_unicode_escape_encode", "raw_unicode_escape_decode",
  "latin_1_encode", "latin_1_decode", "ascii_encode", "ascii_decode",
  "charmap_encode", "charmap_decode", "charmap_build", "readbuffer_encode",
  "register_error", "_unregister_error", "lookup_error"
] as const;

export function createRuntimeCodecModule(codecs:RuntimeCodecRegistry,keys:KeyOperations<RuntimeValue>,moduleType:TypeValue,encodingMapType:()=>TypeValue):RuntimeValue {
  const {values,meter}=codecs;
  meter.checkpoint(1,128);
  const namespace=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const module=values.instance(moduleType,namespace);
  const bindings=new Map([
    ...createRuntimeCodecRegistryFunctions(codecs),
    ...createRuntimeCoreCodecFunctions(codecs),
    ...createRuntimeWideCodecFunctions(codecs),
    ["charmap_build",createRuntimeCharmapBuild(values,meter,keys,encodingMapType)] as const
  ]);
  namespace.items.set(values.internString("__name__"),values.string("_codecs"));
  namespace.items.set(values.internString("__doc__"),values.none);
  namespace.items.set(values.internString("__package__"),values.string(""));
  for(const name of nativeCodecExports){
    meter.checkpoint(1,96);
    const binding=bindings.get(name);
    if(binding===undefined)throw Error(`missing native codec binding: ${name}`);
    namespace.items.set(values.internString(name),values.builtinFunction({...binding.value,moduleOwner:module}));
  }
  return module;
}
