/** Fixed UTF-16LE metadata; short tables omit the identity ASCII half. */
export function unpackCodepage(encoded:string):readonly number[]{
 const bytes=atob(encoded),offset=bytes.length===256?128:0;
 const values=Array.from({length:offset},(_,byte)=>byte);
 for(let i=0;i<bytes.length;i+=2){const point=bytes.charCodeAt(i)|(bytes.charCodeAt(i+1)<<8);values.push(point===65535?-1:point);}
 return Object.freeze(values);
}
