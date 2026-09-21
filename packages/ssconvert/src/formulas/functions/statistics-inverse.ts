// SPDX-License-Identifier: GPL-2.0-or-later
// Captured Gnumeric 1.12.61 sf-dpq.c pfuncinverter.
import type { FunctionHost } from './types.js';
import { normalQuantile } from './normal-distribution.js';

function logComplement(value:number):number { return value > -Math.LN2 ? Math.log(-Math.expm1(value)) : Math.log1p(-Math.exp(value)); }
/** Source qbeta initial approximation followed by the captured generic inverter. */
export function sourceBetaQuantile(p:number,a:number,b:number,lower:boolean,log:boolean,logBeta:number,cdf:(x:number,lower:boolean,log:boolean)=>number,density:(x:number,log:boolean)=>number,host:FunctionHost):number {
  if(a<0||b<0||Number.isNaN(a+b)||Number.isNaN(p))return NaN;
  if(!log&&p>.9){p=1-p;lower=!lower;}
  let guess:number;
  if(a>=1&&b>=1){const z=normalQuantile(p,!lower,log),ta=1/(2*a-1),tb=1/(2*b-1),h=2/(ta+tb),l=(z*z-3)/6,w=z*Math.sqrt(h+l)/h-(tb-ta)*(l+(5-4/h)/6);guess=a/(a+b*Math.exp(2*w));}
  else {
    const half=cdf(.5,lower,log);
    if(!lower===(p>half)){const target=log?lower?p:logComplement(p):Math.log(lower?p:.5-p+.5);guess=Math.exp((Math.log(a)+target+logBeta)/a);}
    else {const target=log?lower?logComplement(p):p:Math.log(lower?.5-p+.5:p);guess=-Math.expm1((Math.log(b)+target+logBeta)/b);}
  }
  return sourceContinuousInverse(p,lower,log,0,1,guess,x=>cdf(x,lower,log),x=>density(x,log),host);
}
export function sourceContinuousInverse(p:number,lower:boolean,log:boolean,low:number,high:number,guess:number,cdf:(x:number)=>number,density:((x:number)=>number)|undefined,host:FunctionHost):number {
  if(log?p>0:p<0||p>1)return NaN;
  if(p===(log?lower?-Infinity:0:lower?0:1))return low;
  if(p===(log?lower?0:-Infinity:lower?1:0))return high;
  let haveLow=Number.isFinite(low),haveHigh=Number.isFinite(high),elo=(log?lower?-Infinity:0:lower?0:1)-p,ehi=(log?lower?0:-Infinity:lower?1:0)-p,x=0,e=0;
  if(!lower){elo=-elo;ehi=-ehi;}
  for(let i=0;i<100;i++) {
    host.tick();
    if(i===0){
      if(guess>low&&guess<high)x=guess;
      else if(haveLow&&guess<=low)x=low+Number(haveHigh)?(high-low)/100:1;
      else if(haveHigh&&guess>=high)x=high-Number(haveLow)?(high-low)/100:1;
      else x=0;
    }else if(i===1)x=haveLow&&haveHigh?(low+high)/2:haveLow?low*1.1:high/1.1;
    else if(haveLow&&haveHigh){
      switch(i%8){
        case 0:x=high-(high-low)*(ehi/(ehi-elo));break;
        case 4:x=low>=0&&high>=0?Math.sqrt(Math.max(2**-1022,low))*Math.sqrt(high):low<=0&&high<=0?-Math.sqrt(-low)*Math.sqrt(Math.max(2**-1022,-high)):0;break;
        case 2:x=(high+1000*low)/1001;break;
        case 6:x=(1000*high+low)/1001;break;
        default:x=(high+low)/2;
      }
    }else x=haveLow?low<1?1:(2*i)*low:high>-1?-1:(2*i)*high;
    let retry=true,done=false;
    while(retry){
      host.tick();retry=false;
      if(haveLow&&x<=low||haveHigh&&x>=high)break;
      const px=cdf(x);e=(px-p)*(lower?1:-1);
      if(e===0){done=true;break;}
      if(e>0){high=x;ehi=e;haveHigh=true;}else if(e<0){low=x;elo=e;haveLow=true;}
      if(haveLow&&haveHigh){
        const precision=(high-low)/(Math.abs(low)+Math.abs(high));
        if(precision<Number.EPSILON*4){x=(high+low)/2;e=(cdf(x)-p)*(lower?1:-1);done=true;break;}
        if(density&&i%3<2&&(i===0||precision<.05)){
          let d=density(x);if(log)d=Math.exp(d-px);
          if(d){x-=e/d*1.000001;if(x>low&&x<high){i++;retry=true;}}
        }
      }
    }
    if(done)break;
  }
  if(haveHigh&&Math.abs(e)>ehi){e=ehi;x=high;}
  if(haveLow&&Math.abs(e)>-elo)x=low;
  return x;
}
