/** Expressions replayed against the external pinned oracle and the public
 * session. No host codec participates in guest execution. */
export const wideCodecApiCases:{name:string;expression:string}[]=[];
for(const width of [16,32]){
  for(const suffix of ["","_le","_be","_ex"]){
    for(const operation of suffix==="_ex"?["decode"]:["encode","decode"]){
      const name=`utf_${width}${suffix}_${operation}`,encode=operation==="encode",order=suffix==="_ex"||encode&&suffix==="";
      const maximum=encode?order?3:2:suffix==="_ex"?4:3;
      const source=encode?"'\\ud800'":"b'\\xff'",valid=encode?"'A'":"b''";
      const args=["",...Array.from({length:3},(_,index)=>Array.from({length:maximum+index+1},()=>"None").join(", ")),
        "None","7","[]",`str=${valid}`,`${valid}, errors=None`,`${valid}, 7`,`${valid}, b'strict'`,`${valid}, 'bad\\x00name'`,`${valid}, '\\ud800'`,`${valid}, 'missing'`];
      if(order)for(const value of ["None","1.0","'little'","[]","-2147483649","2147483648","True","False","-2","2"]){args.push(`${valid}, None, ${value}`);}
      if(!encode)for(const final of ["None","[]","[1]","1","0"]){args.push(`${source}, 'replace', ${suffix==="_ex"?"0, ":""}${final}`);}
      for(const policy of ["strict","ignore","replace","backslashreplace","surrogateescape","surrogatepass","xmlcharrefreplace","namereplace","missing"]){
        for(const data of encode?["''","'A'","'\\ud800'","'\\udc80'","'\\udfff'","'A\\ud800B\\udfff'"]:["b''","b'\\xff'","b'\\x00\\xd8'","b'\\x00\\x00\\x11\\x00'"]){
          args.push(`${data}, '${policy}'${encode?"":suffix==="_ex"?", 0, True":", True"}`);
        }
      }
      for(const arguments_ of args)wideCodecApiCases.push({name:`${name}(${arguments_})`,expression:`_codecs.${name}(${arguments_})`});
    }
  }
}
