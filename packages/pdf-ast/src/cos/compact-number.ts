/** A binary64 rounding boundary has at most 1075 fractional decimal places
 * and 309 integer places. Keeping 2048 significant digits plus a sticky digit
 * distinguishes every boundary, including halfway subnormals, without keeping
 * an arbitrarily long source spelling. Number performs the final rounding. */
export class CompactPdfNumber {
 private original:string|undefined="";
 private sign="";
 private digits="";
 private significant=0;
 private fractional=0;
 private decimal=false;
 private exponent=false;
 private exponentNegative=false;
 private power=0n;
 private sticky=false;
 append(character:number):void{
  const text=String.fromCharCode(character);
  if(this.original!==undefined)this.original=this.original.length<2048?this.original+text:undefined;
  if(character===69||character===101){this.exponent=true;return;}
  if(character===43||character===45){if(this.exponent)this.exponentNegative=character===45;else this.sign=text;return;}
  if(character===46){this.decimal=true;return;}
  const digit=character-48;
  if(this.exponent){
   // More than twice the source's maximum safe length cannot be cancelled by
   // its decimal point or omitted digits; saturate without unbounded BigInts.
   const maximum=2n*BigInt(Number.MAX_SAFE_INTEGER);
   if(this.power<maximum){this.power=this.power*10n+BigInt(digit);if(this.power>maximum)this.power=maximum;}
   return;
  }
  if(this.decimal)this.fractional++;
  if(!this.significant&&digit===0)return;
  this.significant++;
  if(this.digits.length<2048)this.digits+=text;
  else if(digit!==0)this.sticky=true;
 }
 get spelling():string{
  if(this.original!==undefined)return this.original;
  const digits=(this.digits||"0")+(this.sticky?"1":"");
  const power=(this.exponentNegative?-this.power:this.power)+BigInt(this.significant-this.digits.length-this.fractional)-(this.sticky?1n:0n);
  return `${this.sign}${digits}e${power}`;
 }
 get shortened():boolean{return this.original===undefined;}
}
