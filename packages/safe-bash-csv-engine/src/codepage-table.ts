const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function decodeBase64Latin1(encoded:string):string{
 let out="",buffer=0,bits=0;
 for(let i=0;i<encoded.length;i++){
  const ch=encoded[i]!;if(ch==="=")break;
  const value=alphabet.indexOf(ch);if(value<0)continue;
  buffer=(buffer<<6)|value;bits+=6;
  if(bits>=8){bits-=8;out+=String.fromCharCode((buffer>>>bits)&255);}
 }
 return out;
}
export function encodeBase64Latin1(bytes:string):string{
 let out="";
 for(let i=0;i<bytes.length;i+=3){
  const b0=bytes.charCodeAt(i)&255,has1=i+1<bytes.length,has2=i+2<bytes.length;
  const b1=has1?bytes.charCodeAt(i+1)&255:0,b2=has2?bytes.charCodeAt(i+2)&255:0;
  const triplet=(b0<<16)|(b1<<8)|b2;
  out+=alphabet[(triplet>>>18)&63]!+alphabet[(triplet>>>12)&63]!+(has1?alphabet[(triplet>>>6)&63]!:"=")+(has2?alphabet[triplet&63]!:"=");
 }
 return out;
}
/** Fixed UTF-16LE metadata; short tables omit the identity ASCII half. */
export function unpackCodepage(encoded:string):readonly number[]{
 const bytes=decodeBase64Latin1(encoded),offset=bytes.length===256?128:0;
 const values=Array.from({length:offset},(_,byte)=>byte);
 for(let i=0;i<bytes.length;i+=2){const point=bytes.charCodeAt(i)|(bytes.charCodeAt(i+1)<<8);values.push(point===65535?-1:point);}
 return Object.freeze(values);
}
