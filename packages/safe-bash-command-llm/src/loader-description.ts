/** Match native loader documentation indentation without changing blank lines. */
export function formatLoaderDescription(value:string|undefined):string[] {
 const lines=(value||'Undocumented').split('\n');let common:string|undefined;
 for(const line of lines){
  if(!line.trim())continue;
  let width=0;while(line[width]===' '||line[width]==='\t')width++;
  const indent=line.slice(0,width);
  if(common===undefined)common=indent;else{let i=0;while(i<common.length&&common[i]===indent[i])i++;common=common.slice(0,i);}
 }
 const description=lines.map(line=>line.trim()?line.slice(common?.length??0):'').join('\n').trim();
 return description.split('\n').map(line=>line?`  ${line}`:line);
}
