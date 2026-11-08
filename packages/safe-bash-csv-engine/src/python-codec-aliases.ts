// Frozen CPython 3.14.2 standard codec registry; see docs/csvkit/encoding-qualification.md.
// Canonical aliases are inferred; fixed fragments expand in reverse dependency order.
export const pythonCodecAliases: Readonly<Record<string,string>> = /* @__PURE__ */ (()=>{
 let packed="cp273,273<273W273H424,424<424KheW424H43|437Gpc8Ppage437W437H50}500<500KbeKchW500;ascii,64{*si_x3.4S6=*si_x3.4SR,*si_x3_4S68$367GasciiW36|B646_us,B_646.irvS91I{us,us_asciiH775,775Gpc775balticW775HZ}Z0GpcZ0multilingualWZ0HZ>Z2GpcpZ2WZ2HZ5,Z5<Z5WZ5HZ|Z7<Z7WZ7HZ=Z8<Z8WZ8HR}R0<R0WR0HR:R1$_is<R1WR1HR>R2GpcR2ChebrewWR2HR3,R3<R3WR3HR4,R4<R4WR4HR5,R5<R5WR5HR{R6<R6WR6HR9,R9$_gr<R9WR9H874,874,ms874,windows_874H93>93>ms93>ms_k*ji,msk*ji,windows_31j;gbk,936$93{ms936H949,949,ms949,uhcH95}95}ms950H!2{!26<!26W!26H1N,1N$R6uW1N,rusciiH114}1140W1140HN}N0D0HN:N1D1HN>N2D2HN3,N3D3HN4,N4D4HN5,N5D5HN{N6D6HN|N7D7HN=N8D8E:8Z9$819%1W819,B8Z9A1A1~7I!}l:C,C:C_1H03|037<037KcaKnlKusKwtW037W039E{arabic,asmo_708%arabic,ecma_114A6A6~7I127;base64,base64_Pc,base_64;?,?_twG?,x_L_trad_^;?hkscs,?_hkscs,hkscs;bz>bz2_Pc;charmap;#,^GB58#8}X_cn,Xcn,X#_cn,#~}#_80I5=x_L_simp_^H!06;hp-@8$!51W!5:r=@8;johab$136:ms1361;ptcp154$154Gptcp154,U_asi*,pt154+8$6500:u=O,O=O8_ucs>O8_ucs4H720H737HZ6H875;X_krGXkr,Xkr,kore*,ks_c_560:ks_c_5601~|ks_x_!0:ksc560:ksx!0:x_L_kore*;BJ_jpG(,(,B_J_jp;BJ_krGBJkr,BJkr,B_J_krE2%2A2A2~7I!:l>C2E3%3A3A3~8I!9,l3,C3E4%4A4A4~8I1!,l4,C4E9%5A9A9~9I14=l5,C5E!%6A!A!S92I15|l{C6E5%U,UA5A5~8I144E7%/,ecma_11=elot_92=/,/8A7A7~7I126E8%hebrew,hebrewA8A8~8A8_eA8_iI138;koi8-rGkoi8r;Y_VGYV,s_V,YV,sV,x_L_jap*ese;X_V_TX_VTXVTM;X_M,XM;X_jp,Xjp,u_V,uV;gb1803}gb18030[0;hex,hex_Pc;hz,hz_gb,hz_gb_231>hzgb;idna;BQ:(_:B_Q1;BQ>(_>B_Q2;BQT(_TB_Q2004;BQ3,(_3,B_Q3;BQext,(_ext,B_QextE11A11A11[:thaiE13A13,l|C7E14A14A14S9=B_celticI199,l=C8E15A15,l9,C9E16A16A16[1I22{l!,C!;tis-620I16{tis62))2529_)2529_1;koi8-t;koi8-u;kz!4=kz_!4=rk!4=strk!48[2&arabic&C>L_centeuro,Lcentraleurope,LC2&croati*&U,LU&farsi&/,L/&icel*d,Licel*d&@,Lintosh,L@&@i*&turkish,Lturkish;palmos;punyP;quopri,quopri_Pc,quoted_printable,quotedprintable;raw-]-escape;rot-13,rot13;Y_V_Ts_V_TYVTsV[4;Y_M,s_M,YM,sM+1{u1{O16+3>u3>O32+|u|]_1_1_O_|O7;undefined;]-escape+16-be,]big`be+16-le,]little`le+32-be,O_32be+32-le,O_32le+8-sig;uu,uu_Pc;zlib,zip,zlib_Pc";
 const markers="ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+/:<=>?@[]^`{|}~",fragments=",iso_8859_~iso~latin~,windows_125~;B8859-~ibm~,cs~;cp~,B_ir_~2022~,ebcdic_cp_~mac~jisx0213~125~utf~code~J_jp_~86~_19~2004,~cyrillic~jis~,F~euc~shift~85~10~gb2312~,cp~GBC~;L-~BJjp~0,tis_620_~an~;O-~greek~1,~GF~8,~2,~big5~rom*~_200~uniP~chinese~unmarked,O_16~6,~7,~0,~S8".split('~');
 for(let i=fragments.length-1;i>=0;i--)packed=packed.split(markers[i]!).join(fragments[i]!);
 const entries=packed.split(';').flatMap(group=>{
  const [codec,...aliases]=group.split(',');aliases.push(codec!.replaceAll('-','_'));
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

