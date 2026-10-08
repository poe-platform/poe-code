// Frozen CPython 3.14.2 standard codec registry; see docs/csvkit/encoding-qualification.md.
// Each group contains a canonical codec followed by its aliases. Uppercase and
// punctuation markers expand repeated fixed name fragments before decoding.
export const pythonCodecAliases: Readonly<Record<string, string>> = /* @__PURE__ */ (()=>{
 let packed="cp037,037,cp037,csE037,Lca,Lnl,Lus,Lwt,E037,E039;W026,1026,W026,csE1026,E1026;WY,1Y,WY,G66u,E1Y,ru+;W140,1140,W140,E1140;H0,Y0,H0,F0;H1,Y1,H1,F1;H2,Y2,H2,F2;H3,Y3,H3,F3;H4,Y4,H4,F4;H5,Y5,H5,F5;H6,Y6,H6,F6;H7,Y7,H7,F7;H8,Y8,H8,F8;cp273,273,cp273,csE273,E273;cp424,424,cp424,csE424,Lhe,E424;cp437,437,cp437,cspc8Mpage437,E437;cp500,500,cp500,csE500,Lbe,Lch,E500;a+,646,<.4_1968,<.4R6,<_4_1968,a+,cp367,csa+,E367,A646_us,A_646.irv_1991,A_ir_6,us,us_a+;cp775,775,cp775,cspc775baltic,E775;G50,850,G50,cspc850multilingual,E850;G52,852,G52,cspG52,E852;G55,855,G55,csE855,E855;G57,857,G57,csE857,E857;G58,858,G58,csE858,E858;G60,860,G60,csE860,E860;G61,861,G61,cp_is,csE861,E861;G62,862,G62,cspc862Dhebrew,E862;G63,863,G63,csE863,E863;G64,864,G64,csE864,E864;G65,865,G65,csE865,E865;G66,866,G66,csE866,E866;G69,869,G69,cp_gr,csE869,E869;G74,874,G74,ms874,windows_874;AB-1,B,G19,csAD1,E819,AB,AB_1,A_B_1,A_B_1R7,AN00,l1,D,D1,D_1;)32,932,)32,ms932,ms_kanji,mskanji,windows_31j;gbk,936,)36,gbk,ms936;)49,949,)49,ms949,uhc;)50,950,)50,ms950;AB-6,%,asmo_708,csAD%,ecma_114,AB_6,A_B_6,A_B_6R7,AN27;base64,base64,base64_Mc,base_64;!,!,!_tw,cs!,x_I_trad_=;!:,!_:,!:,:;bz2,bz2,bz2_Mc;charmap,charmap;X,=,csA58X80,T_cn,Tcn,TX_cn,X,XR0,X_80,A_ir_58,x_I_simp_=;W006,W006;hp-V8,W051,hp_V8,E1051,r8,V8;johab,W361,johab,ms1361;ptW54,W54,csptW54,Q_asian,pt154,ptW54;J-8,cp65001,u8,J,J8,J8_ucs2,J8_ucs4,J_8;cp720,cp720;cp737,cp737;G56,G56;G75,G75;T_kr,csTkr,T_kr,Tkr,korean,ks_c_5601,ks_c_5601R7,ks_x_1001,ksc5601,ksx1001,x_I_korean;AC,csASjp,AC,ASjp,A_C;AS_kr,csASkr,AS_kr,ASkr,A_S_kr;AB-2,csAD2,AB_2,A_B_2,A_B_2R7,AN01,l2,D2;AB-3,csAD3,AB_3,A_B_3,A_B_3R8,AN09,l3,D3;AB-4,csAD4,AB_4,A_B_4,A_B_4R8,AN10,l4,D4;AB-9,csAD5,AB_9,A_B_9,A_B_9R9,AN48,l5,D5;AB-10,csAD6,AB_10,A_B_10,A_B_10_1992,AN57,l6,D6;AB-5,csADQ,Q,AB_5,A_B_5,A_B_5R8,AN44;AB-7,csADZ,ecma_118,elot_928,Z,Z8,AB_7,A_B_7,A_B_7R7,AN26;AB-8,csADhebrew,hebrew,AB_8,A_B_8,A_B_8R8,A_B_8_e,A_B_8_i,AN38;#-r,cs#r,#_r;P_U,csPU,s_U,P_U,PU,sU,x_I_japanese;T_UO4,T_U2004,T_UO4,TU2004,K;T_K,T_K,TK;T_jp,T_jp,Tjp,u_U,uU;>,>,>O0;hex,hex,hex_Mc;hz,hz,hz_gb,hz_gb_2312,hzgb;idna,idna;AC_1,AC_1,ASjp_1,A_C_1;AC_2,AC_2,ASjp_2,A_C_2;ACO4,ACO4,ASjpO4,A_CO4;AC_3,AC_3,ASjp_3,A_C_3;AC_ext,AC_ext,ASjp_ext,A_C_ext;AB-11,AB_11,A_B_11,A_B_11O1,thai;AB-13,AB_13,A_B_13,l7,D7;AB-14,AB_14,A_B_14,A_B_14_1998,A_celtic,AN99,l8,D8;AB-15,AB_15,A_B_15,l9,D9;AB-16,AB(,A_B(,A_B(O1,A_ir_226,l10,D10;tis-620,AN66,tis620,$,$_0,$_2529_0,$_2529_1;#-t,#_t;#-u,#_u;kz/,kz/,kz_/,rk/,strk/O2;I-%,I_%;I-D2,I_centeuro,I_D2,Icentraleurope,ID2;I-croatian,I_croatian;I-Q,I_Q,IQ;I-farsi,I_farsi;I-Z,I_Z,IZ;I-?,I_?,I?;I-V,I_V,Iintosh,IV;I-Vian,I_Vian;I-@,I_@,I@;palmos,palmos;punyM,punyM;quopri,quopri,quopri_Mc,quoted_printable,quotedprintable;raw-*M-&,raw_*M_&;rot-13,rot13,rot_13;P_UO4,s_UO4,P_UO4,PU2004,sUO4;P_K,s_K,P_K,PK,sK;J-16,u16,J16,J(;J-32,u32,J32,J_32;J-7,u7,*M_1_1_J_7,J7,J_7;undefined,undefined;*M-&,*M_&;J-16-be,*Mbigunmarked,J(_be,J(be;J-16-le,*Mlittleunmarked,J(_le,J(le;J-32-be,J_32_be,J_32be;J-32-le,J_32_le,J_32le;J-8-sig,J_8_sig;uu,uu,uu_Mc;zlib,zip,zlib,zlib_Mc";
 const markers="ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+/:<=>?@";
 "iso|8859|2022_jp|latin|ibm|windows_125|cp8|cp125|mac|utf|jisx0213|ebcdic_cp_|code|_ir_1|_200|shift|cyrillic|_198|2022|euc|jis|roman|cp1|gb2312|125|greek|big5|koi8|tis_620|arabic|escape|_16|cp9|uni|scii|1048|hkscs|ansi_x3|chinese|gb18030|iceland|turkish".split('|').forEach((text,index)=>{packed=packed.split(markers[index]!).join(text);});
 const entries=packed.split(';').flatMap(group=>{
  const [codec,...aliases]=group.split(',');
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

