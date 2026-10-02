// SQLite preserves identifier quoting and ALTER TABLE whitespace in catalogs.
// Compare lexical tokens, retaining literal values and all constraint syntax.
export function sqliteSchemaTokens(sql:string):string {
 const tokens:string[]=[];
 for(let i=0;i<sql.length;){
  const ch=sql[i]!;
  if(' \t\r\n\f'.includes(ch)){i++;continue;}
  if(ch==='"'||ch==='['||ch==='`'||ch==="'"){
   const end=ch==='['?']':ch;let value='',closed=false;i++;
   while(i<sql.length){const next=sql[i++]!;if(next===end){if(end!==']'&&sql[i]===end){value+=end;i++;continue;}closed=true;break;}value+=next;}
   if(!closed)throw new Error('Invalid history schema quoting');
   tokens.push(ch==="'"?'literal:'+value:'word:'+value.toLowerCase());continue;
  }
  const word=(c:string):boolean=>c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c==='_';
  if(word(ch)){let value='';while(i<sql.length&&word(sql[i]!))value+=sql[i++];tokens.push('word:'+value.toLowerCase());}
  else{tokens.push(ch);i++;}
 }
 return JSON.stringify(tokens);
}

