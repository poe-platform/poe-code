// GNU C Library, Copyright (C) 2018-2025 Free Software Foundation, Inc.
// LGPL-2.1-or-later; see captured-pow-NOTICE.md and ../../encoding/LGPL-2.1.txt.

import type { FunctionHost } from "./types.js";
import {fusedMultiplyAdd as fma} from "./numeric-arithmetic.js";
import {logPolynomial as A,logTable,expTable} from './captured-pow-profile.js';
const view=new DataView(new ArrayBuffer(8));
const fromBits=(bits:bigint)=>{view.setBigUint64(0,BigInt.asUintN(64,bits));return view.getFloat64(0);};
const toBits=(x:number)=>{view.setFloat64(0,x);return view.getBigUint64(0);};
/** Captured aarch64 glibc 2.41 powers for nonnegative Hankel quadrature. */
export function capturedPow(x:number,y:number,host:Pick<FunctionHost,"tick">):number{
 host.tick();
 if(x===0&&y>0)return x ** y;
 if(!(x>0&&Number.isFinite(x)&&y>=.25&&y<=4))return x**y;
 let ix=toBits(x); if (ix >> 52n === 0n) ix=toBits(x*2**52)-(52n<<52n);
 const tmp=BigInt.asUintN(64,ix-0x3fe6955500000000n),i=Number(tmp>>45n&127n),k=Number(BigInt.asIntN(64,tmp)>>52n),iz=ix-(tmp&(0xfffn<<52n)),z=fromBits(iz);
 const [invc,logc,logctail]=logTable[i]!;const r=fma(z,invc!,-1),t1=fma(k,.6931471805598903,logc!),t2=t1+r,lo1=fma(k,5.497923018708371e-14,logctail!),lo2=t1-t2+r;
 host.tick();
 const ar=A[0]!*r,ar2=r*ar,ar3=r*ar2,hi=t2+ar2,lo3=fma(ar,r,-ar2),lo4=t2-hi+ar2;
 const p=fma(ar2,fma(ar2,fma(r,A[6]!,A[5]!),fma(r,A[4]!,A[3]!)),fma(r,A[2]!,A[1]!));
 const lo=fma(ar3,p,lo1+lo2+lo3+lo4),h=hi+lo,l=hi-h+lo;
 host.tick();
 const ehi=y*h,elo=fma(y,l,fma(y,h,-ehi));
 if(Math.abs(ehi)>=512)return x**y;
 if(Math.abs(ehi)<2**-54)return 1+ehi;
 host.tick();
 const z2=184.6649652337873*ehi,integer=Math.trunc(z2),kd=Math.abs(z2-integer)>=.5?integer+Math.sign(z2):integer,ki=BigInt(kd);
 const rr=fma(kd,-1.2864023111638346e-14,fma(kd,-.005415212348111709,ehi))+elo;
 const idx=2*Number(ki&127n),tail=fromBits(expTable[idx]!),sbits=expTable[idx+1]!+(ki<<45n),scale=fromBits(sbits),r2=rr*rr;
 host.tick();
 const result=fma(r2*r2,fma(rr,.008333335853059549,0.0416666808410674),fma(r2,fma(rr,0.16666666666665886,.49999999999996786),tail+rr));
 return fma(scale,result,scale);
}
