// SPDX-License-Identifier: GPL-2.0-or-later
// Gnumeric 1.12.61 mathfunc.c Ian/DJMSmith small-parameter binomial path.
import { capturedExp, fusedMultiplyAdd as fma } from './numeric-arithmetic.js';
import { capturedLog1p } from './captured-log1p.js';
import type { FunctionHost } from './types.js';
import { logGamma } from './scientific.js';
const lgammaCoefficients = [Number("0.3224670334241132182362075833230126e-0"),Number("0.6735230105319809513324605383715000e-1"),Number("0.2058080842778454787900092413529198e-1"),Number("0.7385551028673985266273097291406834e-2"),Number("0.2890510330741523285752988298486755e-2"),Number("0.1192753911703260977113935692828109e-2"),Number("0.5096695247430424223356548135815582e-3"),Number("0.2231547584535793797614188036013401e-3"),Number("0.9945751278180853371459589003190170e-4"),Number("0.4492623673813314170020750240635786e-4"),Number("0.2050721277567069155316650397830591e-4"),Number("0.9439488275268395903987425104415055e-5"),Number("0.4374866789907487804181793223952411e-5"),Number("0.2039215753801366236781900709670839e-5"),Number("0.9551412130407419832857179772951265e-6"),Number("0.4492469198764566043294290331193655e-6"),Number("0.2120718480555466586923135901077628e-6"),Number("0.1004322482396809960872083050053344e-6"),Number("0.4769810169363980565760193417246730e-7"),Number("0.2271109460894316491031998116062124e-7"),Number("0.1083865921489695409107491757968159e-7"),Number("0.5183475041970046655121248647057669e-8"),Number("0.2483674543802478317185008663991718e-8"),Number("0.1192140140586091207442548202774640e-8"),Number("0.5731367241678862013330194857961011e-9"),Number("0.2759522885124233145178149692816341e-9"),Number("0.1330476437424448948149715720858008e-9"),Number("0.6422964563838100022082448087644648e-10"),Number("0.3104424774732227276239215783404066e-10"),Number("0.1502138408075414217093301048780668e-10"),Number("0.7275974480239079662504549924814047e-11"),Number("0.3527742476575915083615072228655483e-11"),Number("0.1711991790559617908601084114443031e-11"),Number("0.8315385841420284819798357793954418e-12"),Number("0.4042200525289440065536008957032895e-12"),Number("0.1966475631096616490411045679010286e-12"),Number("0.9573630387838555763782200936508615e-13"),Number("0.4664076026428374224576492565974577e-13"),Number("0.2273736960065972320633279596737272e-13"),Number("0.1109139947083452201658320007192334e-13")];
const scale = 2 ** 256;
function lgamma1p(a:number,host:FunctionHost):number {
  if(Math.abs(a)>=.5)return a+1<=0&&Number.isInteger(a+1)?Infinity:logGamma(a+1,host);
  let result=Number('0.2273736845824652515226821577978691e-12')*logcf(-a/2,42,1,host);
  for(let i=39;i>=0;i--){host.tick();result=fma(-a,result,lgammaCoefficients[i]!);}
  return fma(a,result,-Number('0.5772156649015328606065120900824024'))*a-log1pmx(a,host);
}
function logfbitDerivative(x:number,order:1|3|5|7,host:FunctionHost):number {
  if(x<=-1)return -Infinity;
  const factorial=order===1?1:order===3?6:order===5?120:5040;
  if(x>=1e10)return -factorial/12*(x+1)**(-order-1);
  if(x>=6){
    const n=x+1,z=1/(n*n),coefficients=[1/30,1/105,1/140,1/99,691/30030,1/13,Number('3.5068606896459316479e-01'),Number('1.6769998201671114808')];
    let result=0;for(let j=7;j>=0;j--){host.tick();let multiplier=1;for(let k=0;k<order;k++)multiplier*=2*j+3+k;result=fma(-z,result,coefficients[j]!*multiplier);}
    return -(1/12)*(factorial-z*result)*z**((order+1)/2);
  }
  let total=0;while(x<6){host.tick();const product=(x+1)*(x+2),y=1/(2*x+3);
    total+=order===1?(y*y*logcf(y*y,3,2,host)-1/(4*product))/(x+1.5):order===3?-(2*x+3)*product**-3:order===5?-6*(2*x+3)*((5*x+15)*x+12)*product**-5:-120*(2*x+3)*((((14*x+84)*x+196)*x+210)*x+87)*product**-7;
    x++;
  }
  return total+logfbitDerivative(x,order,host);
}
/** Captured pbeta_smalla, including the release's nonpositive-parameter behavior. */
export function sourceSmallABeta(x:number,a:number,b:number,lower:boolean,log:boolean,host:FunctionHost):number {
  if(x>.5){const previous=a;a=b;b=previous;x=1-x;lower=!lower;}
  const square=a*a,center=a/2+b;
  const difference=a>.03*(a+b)?logfbit(a+b,host)-logfbit(b,host):a*(logfbitDerivative(center,1,host)+square/24*(logfbitDerivative(center,3,host)+square/80*(logfbitDerivative(center,5,host)+square/168*logfbitDerivative(center,7,host))));
  let r=(a+b+.5)*log1pmx(a/(1+b),host)+a*(a-.5)/(1+b)+difference;
  r+=a*Math.log((1+b)*x)-lgamma1p(a,host);
  let term=x,d=2,total=term/(a+1);while(Math.abs(term)>Math.abs(total*5e-16)){host.tick();term*=(d-b)*x/d;total+=term/(a+d);d++;}
  const complement=a*(b-1)*total;
  if(log){const value=r+capturedLog1p(-complement)+Math.log(b/(a+b));return lower?value:value>-1/Math.log(2)?Math.log(-Math.expm1(value)):capturedLog1p(-capturedExp(value));}
  if(lower)return capturedExp(r)*(1-complement)*(b/(a+b));
  r=-Math.expm1(r);r+=complement*(1-r);r+=(a/(a+b))*(1-r);return r;
}
function logcf(x:number,i:number,d:number,host:FunctionHost):number {
  let c1=2*d,c2=i+d,c4=c2+d,a1=c2,b1=i*(c2-i*x),b2=d*d*x,a2=c4*c2-b2;
  b2=c4*b1-i*b2;
  while(Math.abs(a2*b1-a1*b2)>Math.abs(1e-14*b1*b2)) {
    host.tick();let c3=c2*c2*x;c2+=d;c4+=d;
    a1=fma(c4,a2,-c3*a1);b1=fma(c4,b2,-c3*b1);
    c3=c1*c1*x;c1+=d;c4+=d;
    a2=fma(c4,a1,-c3*a2);b2=fma(c4,b1,-c3*b2);
    if(Math.abs(b2)>scale){a1/=scale;b1/=scale;a2/=scale;b2/=scale;}
    else if(Math.abs(b2)<1/scale){a1*=scale;b1*=scale;a2*=scale;b2*=scale;}
  }
  return a2/b2;
}
function log1pmx(x:number,host:FunctionHost):number {
  if(x>1||x<-.79149064)return capturedLog1p(x)-x;
  const r=x/(2+x),y=r*r;
  if(Math.abs(x)<.01)return r*(fma(fma(fma(2/9,y,2/7),y,2/5),y,2/3)*y-x);
  return r*fma(2*y,logcf(y,3,2,host),-x);
}
function logfbit(x:number,host:FunctionHost):number {
  host.tick();
  if(x<=-1)return Infinity;
  if(x>=1e10)return 1/(12*(x+1));
  if(x>=6){const n=x+1,z=1/(n*n),c=[1/30,1/105,1/140,1/99,691/30030,1/13,Number('3.5068606896459316479e-01'),Number('1.6769998201671114808')];let p=c[7]!;for(let i=6;i>=0;i--)p=fma(-z,p,c[i]!);return (1/12)*(1-z*p)/n;}
  if(Number.isInteger(x)&&x>=0)return [Number('.081061466795327258219670263594382360138'),Number('.041340695955409294093822081407117508025'),Number('.027677925684998339148789292746244666596'),Number('.020790672103765093111522771767848656333'),Number('.016644691189821192163194865373593391145'),Number('.013876128823070747998745727023762908562')][x]!;
  let total=0;while(x<6){host.tick();const y=1/(2*x+3),square=y*y;total+=square*logcf(square,3,2,host);x++;}return total+logfbit(x,host);
}
function binomialTerm(i:number,j:number,p:number,q:number,dfm:number,log:boolean,host:FunctionHost):number {
  if(i===0&&j<=0)return log?0:1;
  if(i<=-1||j<0)return log?-Infinity:0;
  const c1=i+1+j,ps=p<q?p:q,c2=p<q?i:j,c3=p<q?j:i,d=p<q?dfm:-dfm,c5=(d-(1-ps))/(c2+1),c6=-(d+ps)/(c3+1);
  if(c5<-.79149064&&c2===0){const exponent=c3*capturedLog1p(-ps);return log?exponent:capturedExp(exponent);}
  const t=c5<-.79149064?Math.log(ps*c1/(c2+1))-c5:log1pmx(c5,host),c4=logfbit(i+j,host)-logfbit(i,host)-logfbit(j,host);
  const exponent=fma(c2,t,c4)-c5+fma(c3,log1pmx(c6,host),-c6);
  const factor=c1/((c2+1)*(c3+1)*2*Math.PI);
  return log?exponent+.5*Math.log(factor):capturedExp(exponent)*Math.sqrt(factor);
}
/** Released binomial CF branch; nonpositive beta parameters retain its source behavior. */
export function smallParameterBeta(x:number,small:number,large:number,lower:boolean,log:boolean,host:FunctionHost):number {
  const pp=1-x,qq=x,jj=large;let ii=-small,ip1=ii+1,diff=0,probability:number;
  if(ii>-1&&(jj<=0||pp===0))return lower?log?0:1:log?-Infinity:0;
  if(ii>-1&&ii<0){ii=-ii;ip1=ii;const factor=ii/((ii+jj)*pp);probability=binomialTerm(ii,jj,pp,qq,(ii+jj)*pp-ii,log,host);probability=log?probability+Math.log(factor):probability*factor;ii--;diff=(ii+jj)*pp-ii;}
  else probability=binomialTerm(ii,jj,pp,qq,diff,log,host);
  const n1=ii+3+jj,swapped=ii<0?false:pp>qq?n1*qq>=jj+1:n1*pp<=ii+2;
  if(probability===(log?-Infinity:0))return swapped===!lower?probability:log?0:1;
  const i=swapped?jj-1:ii,j=swapped?ip1:jj,p=swapped?qq:pp,q=swapped?pp:qq,dfm=swapped?1-diff:diff;
  if(swapped)ip1=jj;
  let numb=i>0?Math.floor(Math.floor(6*Math.sqrt(p+.5)*capturedExp(Math.log(n1*p*q)/3))-dfm):Math.floor(i);
  if(numb>i)numb=Math.floor(i);if(numb<0)numb=0;
  let a1=0,b1=1,a2=(i-numb)*q,b2=dfm+numb+1,c1=0,c2=a2,c4=b2;
  while(Math.abs(a2*b1-a1*b2)>Math.abs(1e-15*b1*b2)) {
    host.tick();c1++;c2-=q;let c3=c1*c2;c4+=q+1;
    a1=fma(c4,a2,c3*a1);b1=fma(c4,b2,c3*b1);
    c1++;c2-=q;c3=c1*c2;c4+=q+1;
    a2=fma(c4,a1,c3*a2);b2=fma(c4,b1,c3*b2);
    if(Math.abs(b2)>scale){a1/=scale;b1/=scale;a2/=scale;b2/=scale;}
    else if(Math.abs(b2)<1/scale){a1*=scale;b1*=scale;a2*=scale;b2*=scale;}
  }
  a1=a2/b2;let ni=(i-numb+1)*q,nj=(j+numb)*p;
  while(numb>0){host.tick();a1=(1+a1)*(ni/nj);ni+=q;nj-=p;numb--;}
  probability=log?probability+capturedLog1p(a1):probability*(1+a1);
  if(swapped){const factor=ip1*q/nj;probability=log?probability+Math.log(factor):probability*factor;}
  if(swapped===!lower)return probability;
  return log?probability>-1/Math.log(2)?Math.log(-Math.expm1(probability)):capturedLog1p(-capturedExp(probability)):1-probability;
}
