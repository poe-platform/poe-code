// Adapted from V8 14.6.202.34's Python-derived TimSort. See THIRD_PARTY_NOTICES.md.
// Numeric record identities and merge scratch belong to the driver. The program
// retains only scalar cursors and the logarithmic pending-run stack, so a driver
// can keep both arrays on caller storage without collecting glyphs in memory.
export type TextSortRequest =
  | {readonly kind:"read";readonly index:number;readonly temporary:boolean}
  | {readonly kind:"write";readonly index:number;readonly temporary:boolean;readonly value:number}
  | {readonly kind:"compare";readonly left:number;readonly right:number};
type Program<T=void> = Generator<TextSortRequest,T,number>;
export function* sortTextRecordsSteps(length:number):Program {
  if(!Number.isSafeInteger(length)||length<0)throw new RangeError("Invalid text record count");
  function* read(index:number,temporary=false):Program<number>{return yield {kind:"read",index,temporary};}
  function* write(index:number,value:number,temporary=false):Program{yield {kind:"write",index,value,temporary};}
  function* compare(left:number,right:number):Program<number>{return yield {kind:"compare",left,right};}
  function* copy(from:number,to:number,count:number,fromTemporary=false,toTemporary=false):Program{
    if(fromTemporary===toTemporary&&to>from){for(let i=count-1;i>=0;i--)yield* write(to+i,yield* read(from+i,fromTemporary),toTemporary);}
    else for(let i=0;i<count;i++)yield* write(to+i,yield* read(from+i,fromTemporary),toTemporary);
  }
  function* insertion(low:number,start:number,high:number):Program{
    for(let at=start===low?start+1:start;at<high;at++){
      const pivot=yield* read(at);let left=low,right=at;
      while(left<right){const mid=left+Math.floor((right-left)/2);if((yield* compare(pivot,yield* read(mid)))<0)right=mid;else left=mid+1;}
      yield* copy(left,left+1,at-left);yield* write(left,pivot);
    }
  }
  function* run(low:number,high:number):Program<number>{
    if(low+1===high)return 1;
    let previous=yield* read(low+1),count=2;const descending=(yield* compare(previous,yield* read(low)))<0;
    for(let at=low+2;at<high;at++){const value=yield* read(at),order=yield* compare(value,previous);if(descending?order>=0:order<0)break;previous=value;count++;}
    if(descending)for(let left=low,right=low+count-1;left<right;left++,right--){const value=yield* read(left);yield* write(left,yield* read(right));yield* write(right,value);}
    return count;
  }
  function* gallop(key:number,base:number,count:number,hint:number,right:boolean,temporary=false):Program<number>{
    let last=0,offset=1;
    function* order(at:number):Program<number>{const value=yield* read(base+at,temporary);return right?yield* compare(key,value):yield* compare(value,key);}
    const first=yield* order(hint),leftward=right?first<0:first>=0;
    if(leftward){const max=hint+1;while(offset<max){const value=yield* order(hint-offset);if(right?value>=0:value<0)break;last=offset;offset=offset*2+1;}offset=Math.min(offset,max);const previous=last;last=hint-offset;offset=hint-previous;}
    else{const max=count-hint;while(offset<max){const value=yield* order(hint+offset);if(right?value<0:value>=0)break;last=offset;offset=offset*2+1;}offset=Math.min(offset,max);last+=hint;offset+=hint;}
    last++;
    while(last<offset){const mid=last+Math.floor((offset-last)/2),value=yield* order(mid);if(right?value<0:value>=0)offset=mid;else last=mid+1;}
    return offset;
  }
  let minGallop=7;
  function* mergeLow(baseA:number,a:number,baseB:number,b:number):Program{
    yield* copy(baseA,0,a,false,true);let dest=baseA,ta=0,cb=baseB,minimum=minGallop;
    yield* write(dest++,yield* read(cb++));b--;
    merge:while(a>1&&b>0){
      let winsA=0,winsB=0;
      for(;;){
        if((yield* compare(yield* read(cb),yield* read(ta,true)))<0){yield* write(dest++,yield* read(cb++));winsB++;b--;winsA=0;if(!b)break merge;if(winsB>=minimum)break;}
        else{yield* write(dest++,yield* read(ta++,true));winsA++;a--;winsB=0;if(a===1)break merge;if(winsA>=minimum)break;}
      }
      minimum++;let first=true;
      while(winsA>=7||winsB>=7||first){first=false;minimum=Math.max(1,minimum-1);minGallop=minimum;
        winsA=yield* gallop(yield* read(cb),ta,a,0,true,true);
        if(winsA){yield* copy(ta,dest,winsA,true);dest+=winsA;ta+=winsA;a-=winsA;if(a<=1)break merge;}
        yield* write(dest++,yield* read(cb++));if(--b===0)break merge;
        winsB=yield* gallop(yield* read(ta,true),cb,b,0,false);
        if(winsB){yield* copy(cb,dest,winsB);dest+=winsB;cb+=winsB;b-=winsB;if(!b)break merge;}
        yield* write(dest++,yield* read(ta++,true));if(--a===1)break merge;
      }
      minGallop=++minimum;
    }
    if(a===1&&b>0){yield* copy(cb,dest,b);yield* write(dest+b,yield* read(ta,true));}
    else if(a>0)yield* copy(ta,dest,a,true);
  }
  function* mergeHigh(baseA:number,a:number,baseB:number,b:number):Program{
    yield* copy(baseB,0,b,false,true);let dest=baseB+b-1,tb=b-1,ca=baseA+a-1,minimum=minGallop;
    yield* write(dest--,yield* read(ca--));a--;
    merge:while(a>0&&b>1){
      let winsA=0,winsB=0;
      for(;;){
        if((yield* compare(yield* read(tb,true),yield* read(ca)))<0){yield* write(dest--,yield* read(ca--));winsA++;a--;winsB=0;if(!a)break merge;if(winsA>=minimum)break;}
        else{yield* write(dest--,yield* read(tb--,true));winsB++;b--;winsA=0;if(b===1)break merge;if(winsB>=minimum)break;}
      }
      minimum++;let first=true;
      while(winsA>=7||winsB>=7||first){first=false;minimum=Math.max(1,minimum-1);minGallop=minimum;
        winsA=a-(yield* gallop(yield* read(tb,true),baseA,a,a-1,true));
        if(winsA){dest-=winsA;ca-=winsA;yield* copy(ca+1,dest+1,winsA);a-=winsA;if(!a)break merge;}
        yield* write(dest--,yield* read(tb--,true));if(--b===1)break merge;
        winsB=b-(yield* gallop(yield* read(ca),0,b,b-1,false,true));
        if(winsB){dest-=winsB;tb-=winsB;yield* copy(tb+1,dest+1,winsB,true);b-=winsB;if(b<=1)break merge;}
        yield* write(dest--,yield* read(ca--));if(--a===0)break merge;
      }
      minGallop=++minimum;
    }
    if(b===1&&a>0){dest-=a;ca-=a;yield* copy(ca+1,dest+1,a);yield* write(dest,yield* read(tb,true));}
    else if(b>0)yield* copy(0,dest-b+1,b,true);
  }
  const runs:{base:number;length:number}[]=[];
  function* mergeAt(index:number):Program{
    let {base:baseA,length:a}=runs[index]!;const {base:baseB,length:originalB}=runs[index+1]!;let b=originalB;
    runs[index]={base:baseA,length:a+b};runs.splice(index+1,1);
    const skip=yield* gallop(yield* read(baseB),baseA,a,0,true);baseA+=skip;a-=skip;if(!a)return;
    b=yield* gallop(yield* read(baseA+a-1),baseB,b,b-1,false);if(!b)return;
    if(a<=b)yield* mergeLow(baseA,a,baseB,b);else yield* mergeHigh(baseA,a,baseB,b);
  }
  if(length<8){yield* insertion(0,0,length);return;}
  let minimum=length,remainder=0;while(minimum>=64){remainder ||= minimum%2;minimum=Math.floor(minimum/2);}minimum+=remainder;
  const invariant=(n:number)=>n<2||runs[n-2]!.length>runs[n-1]!.length+runs[n]!.length;
  for(let low=0;low<length;){let count=yield* run(low,length);if(count<minimum){const forced=Math.min(minimum,length-low);yield* insertion(low,low+count,low+forced);count=forced;}runs.push({base:low,length:count});
    while(runs.length>1){let n=runs.length-2;if(!invariant(n+1)||!invariant(n)){if(runs[n-1]!.length<runs[n+1]!.length)n--;yield* mergeAt(n);}else if(runs[n]!.length<=runs[n+1]!.length)yield* mergeAt(n);else break;}
    low+=count;
  }
  while(runs.length>1){let n=runs.length-2;if(n>0&&runs[n-1]!.length<runs[n+1]!.length)n--;yield* mergeAt(n);}
}
