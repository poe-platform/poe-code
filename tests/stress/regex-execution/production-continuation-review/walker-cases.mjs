export const walkerCases = [
  { id:'ignore-unclosed-class-is-literal', files:{'.ignore':'[\n','[':'hit bracket\n','alpha.txt':'hit alpha\n'}, args:['hit','.'], code:0, output:'./alpha.txt:hit alpha\n', nativeEquality:true },
  { id:'ignore-malformed-brace-diagnostic', files:{'.ignore':'{a,b\n','alpha.txt':'hit alpha\n'}, args:['hit','.'], code:2, output:'./alpha.txt:hit alpha\n', nativeEquality:false },
];
