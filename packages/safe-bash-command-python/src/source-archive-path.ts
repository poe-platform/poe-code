/** pip 21.2.4 source-archive leading-directory policy. */
export const splitPythonSourcePath=(name:string):[string,string]=>{
 while(name.startsWith('/'))name=name.slice(1);
 while(name.startsWith('\\'))name=name.slice(1);
 const slash=name.indexOf('/'),backslash=name.indexOf('\\');
 const at=slash<0?backslash:backslash<0?slash:Math.min(slash,backslash);
 return at<0?[name,'']:[name.slice(0,at),name.slice(at+1)];
};
