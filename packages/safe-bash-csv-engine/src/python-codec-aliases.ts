// Frozen CPython 3.14.2 standard codec registry; see docs/csvkit/encoding-qualification.md.
// Groups omit each codec's canonical alias, whose hyphens normalize to underscores.
// Markers expand repeated fixed name fragments before decoding the groups.
export const pythonCodecAliases: Readonly<Record<string, string>> = /* @__PURE__ */ (()=>{
 let packed="cp273,273,csD273,D273;cp424,424,csD424,Hhe,D424;cp437,437,cspc8Opage437,D437;cp500,500,csD500,Hbe,Hch,D500;ascii,646,$.4_1968,$.4P6,$_4_1968,cp367,csascii,D367,B646_us,B_646.irv_1991,B_ir_6,us,us_ascii;cp775,775,cspc775baltic,D775;N50,850,cspc850multilingual,D850;N52,852,cspN52,D852;N55,855,csD855,D855;N57,857,csD857,D857;N58,858,csD858,D858;N60,860,csD860,D860;N61,861,cp_is,csD861,D861;N62,862,cspc862Chebrew,D862;N63,863,csD863,D863;N64,864,csD864,D864;N65,865,csD865,D865;N66,866,csD866,D866;N69,869,cp_gr,csD869,D869;N74,874,ms874,windows_874;cp932,932,ms932,ms_kanji,mskanji,windows_31j;gbk,936,cp936,ms936;cp949,949,ms949,uhc;cp950,950,ms950;X026,1026,csD1026,D1026;XL,1L,N66u,D1L,ruscii;X140,1140,D1140;cpL0,L0,E0;cpL1,L1,E1;cpL2,L2,E2;cpL3,L3,E3;cpL4,L4,E4;cpL5,L5,E5;cpL6,L6,E6;cpL7,L7,E7;cpL8,L8,E8;BG1,8859,N19,csBC1,D819,B8859,A1,A1P7,BJ00,l1,C,C1,C_1;cp037,037,csD037,Hca,Hnl,Hus,Hwt,D037,D039;BG6,arabic,asmo_708,csBCarabic,ecma_114,A6,A6P7,BJ27;base64,base64_Oc,base_64;#,#_tw,cs#,x_I_trad_%;#hkscs,#_hkscs,hkscs;bz2,bz2_Oc;charmap;W,%,csB58W80,T_cn,Tcn,TW_cn,WP0,W_80,B_ir_58,x_I_simp_%;X006;hp-Y8,X051,D1051,r8,Y8;johab,X361,ms1361;ptX54,X54,csptX54,R_asian,pt154;M-8,cp65001,u8,M,M8,M8_ucs2,M8_ucs4;cp720;cp737;N56;N75;T_kr,csTkr,Tkr,korean,ks_c_5601,ks_c_5601P7,ks_x_1001,ksc5601,ksx1001,x_I_korean;BFU,csBFjp,BFjp,B_FU;BF_kr,csBFkr,BFkr,B_F_kr;BG2,csBC2,A2,A2P7,BJ01,l2,C2;BG3,csBC3,A3,A3P8,BJ09,l3,C3;BG4,csBC4,A4,A4P8,BJ10,l4,C4;BG9,csBC5,A9,A9P9,BJ48,l5,C5;BG10,csBC6,A10,A10_1992,BJ57,l6,C6;BG5,csBCR,R,A5,A5P8,BJ44;BG7,csBCZ,ecma_118,elot_928,Z,Z8,A7,A7P7,BJ26;BG8,csBChebrew,hebrew,A8,A8P8,A8_e,A8_i,BJ38;koi8-r,cskoi8r;V_S,csVS,s_S,VS,sS,x_I_japanese;T_SQ4,T_S2004,TS2004,K;T_K,TK;TU,Tjp,u_S,uS;gb18030,gb18030Q0;hex,hex_Oc;hz,hz_gb,hz_gb_2312,hzgb;idna;BFU_1,BFjp_1,B_FU_1;BFU_2,BFjp_2,B_FU_2;BFUQ4,BFjpQ4,B_FUQ4;BFU_3,BFjp_3,B_FU_3;BFU_ext,BFjp_ext,B_FU_ext;BG11,A11,A11Q1,thai;BG13,A13,l7,C7;BG14,A14,A14_1998,B_celtic,BJ99,l8,C8;BG15,A15,l9,C9;BG16,A16,A16Q1,B_ir_226,l10,C10;tis-620,BJ66,tis620,!0,!2529_0,!2529_1;koi8-t;koi8-u;kz1048,kz_1048,rk1048,strk1048Q2;I-arabic;I-C2,I_centeuro,Icentraleurope,IC2;I-croatian;I-R,IR;I-farsi;I-Z,IZ;I-iceland,Iiceland;I-Y,Iintosh,IY;I-Yian;I-turkish,Iturkish;palmos;punyO;quopri,quopri_Oc,quoted_printable,quotedprintable;raw-uniO-escape;rot-13,rot13;V_SQ4,s_SQ4,VS2004,sSQ4;V_K,s_K,VK,sK;M-16,u16,M16;M-32,u32,M32;M-7,u7,uniO_1_1_M_7,M7;undefined;uniO-escape;M-16-be,uniObigunmarked,M_16be;M-16-le,uniOlittleunmarked,M_16le;M-32-be,M_32be;M-32-le,M_32le;M-8-sig;uu,uu_Oc;zlib,zip,zlib_Oc";
 const markers="ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%";
 "iso_8859_|iso|latin|ibm|windows_125|2022|8859-|ebcdic_cp_|mac|_ir_1|jisx0213|125|utf|cp8|code|_198|_200|cyrillic|jis|euc|_jp|shift|gb2312|cp1|roman|greek|tis_620_|big5|ansi_x3|chinese".split('|').forEach((text,index)=>{packed=packed.split(markers[index]!).join(text);});
 const entries=packed.split(';').flatMap(group=>{
  const [codec,...aliases]=group.split(',');
  aliases.push(codec!.replaceAll('-','_'));
  return aliases.map(alias=>[alias,codec!] as const);
 });
 entries.sort(([a],[b])=>a<b?-1:a>b?1:0);
 return Object.freeze(Object.fromEntries(entries));
})();

/** encodings.normalize_encoding: punctuation collapses, trailing punctuation drops. */
export function normalizeEncoding(encoding: string): string {
  let result = "", punctuation = false;
  for (const char of encoding) {
    const code = char.codePointAt(0)!;
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char === ".") {
      if (punctuation && result) result += "_";
      result += char.toLowerCase();
      punctuation = false;
    } else punctuation = true;
  }
  return result;
}

