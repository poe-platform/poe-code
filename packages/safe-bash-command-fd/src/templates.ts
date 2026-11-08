import { posixPath } from '@poe-code/safe-fs/core';
export function fdTemplate(template: string): { parts: { text: string; replacement: boolean }[]; count: number } {
  const parts: {text:string;replacement:boolean}[]=[]; let literal='',count=0;
  for (let i=0;i<template.length;) {
    if (template.startsWith('{{',i) || template.startsWith('}}',i)) { literal+=template[i]; i+=2; continue; }
    const token=['{/.}','{//}','{/}','{.}','{}'].find(t=>template.startsWith(t,i));
    if (token) { if (literal) { parts.push({text:literal,replacement:false}); literal=''; } parts.push({text:token,replacement:true}); count++; i+=token.length; }
    else literal+=template[i++]!;
  }
  if (literal) parts.push({text:literal,replacement:false});
  return {parts,count};
}
export function formatFdPath(template: string, path: string): string {
  const base=posixPath.basename(path), extension=posixPath.extname(base);
  const replacements: Record<string,string>={'{}':path,'{/}':base,'{//}':posixPath.dirname(path),'{.}':extension ? path.slice(0,-extension.length) : path,'{/.}':extension ? base.slice(0,-extension.length) : base};
  return fdTemplate(template).parts.map(part=>part.replacement ? replacements[part.text] : part.text).join('');
}
