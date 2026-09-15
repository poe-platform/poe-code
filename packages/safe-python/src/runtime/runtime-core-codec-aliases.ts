/** CPython's core encodings.aliases entries. Canonical module names are kept
 * separate: dots may match alias keys after replacement, but cannot import a
 * canonical encoding module. This is native spelling data, not a guest registry. */
export const coreCodecAliases={
  utf_8:["utf8","u8","utf","utf8_ucs2","utf8_ucs4","cp65001"],
  ascii:["646","ansi_x3.4_1968","ansi_x3_4_1968","ansi_x3.4_1986","cp367","csascii","ibm367","iso646_us","iso_646.irv_1991","iso_ir_6","us","us_ascii"],
  latin_1:["latin1","iso_8859_1","8859","cp819","csisolatin1","ibm819","iso8859","iso8859_1","iso_8859_1_1987","iso_ir_100","l1","latin"]
} as const;

type CoreCodec=keyof typeof coreCodecAliases;
// PyUnicode_AsEncodedString/PyUnicode_Decode shortcuts on the pinned platform.
// Alias resolution is broader than these spellings and uses registry semantics.
export const runtimeTextCodecFastPaths:ReadonlySet<string>=new Set(["utf8","utf_8","utf16","utf_16","utf32","utf_32","ascii","us_ascii","latin1","latin_1","iso_8859_1","iso8859_1"]);

const aliases=new Map<string,CoreCodec>();
for(const name of Object.keys(coreCodecAliases) as CoreCodec[]){
  for(const alias of coreCodecAliases[name])aliases.set(alias,name);
}

/** Accept a registry-normalized name; callers meter normalization and storage. */
export function resolveCoreCodec(name:string):CoreCodec|undefined {
  return aliases.get(name)??aliases.get(name.replaceAll(".","_"))??
    (Object.hasOwn(coreCodecAliases,name)?name as CoreCodec:undefined);
}
