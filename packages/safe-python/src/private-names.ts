import type {SourceMeter} from "./source.js";

/** Mangle normalized identifiers using their lexical class context. */
export function manglePrivateName(name: string, className: string | null,meter?:SourceMeter): string {
  meter?.checkpoint(1+name.length);
  try {
  if (!className || !name.startsWith("__") || name.endsWith("__") || name.includes(".")) return name;
  let start = 0;
  while (className[start] === "_") {meter?.checkpoint();start++;}
  if(start===className.length)return name;
  const suffixLength=className.length-start;
  meter?.checkpoint(suffixLength+name.length,64+2*suffixLength+2*(1+suffixLength+name.length));
  return `_${className.slice(start)}${name}`;
  } finally {meter?.checkpoint();}
}
