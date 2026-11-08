const exponentBound=BigInt(Number.MAX_SAFE_INTEGER)+1100n;

/** A bounded SVG numeric token. 1100 significant decimal digits and a sticky
 * digit distinguish every binary64 midpoint, even for arbitrarily long input. */
export class SvgNumber {
 private phase="start";
 private negative=false;
 private signed=false;
 private fraction=false;
 private fractionDigits=0;
 private digits=0;
 private significant=0;
 private prefix="";
 private sticky=false;
 private exponent=0n;
 private exponentNegative=false;
 private exponentDigits=0;
 private hadExponent=false;
 private suffix="";
 private suffixSpace=false;
 private suffixInvalid=false;
 private special=false;
 private specialInvalid=false;
 private radix=0;
 private radixDigits=0;
 private radixPrefix="";
 private radixInvalid=false;
 private radixTrailing=false;

 accept(char:string):void {
  if(this.phase==="start"){
   if(!char.trim())return;
   this.phase="number";
   if(char==="+"||char==="-"){this.signed=true;this.negative=char==="-";return;}
  }
  if(this.phase==="radix"){
   if(!char.trim()){this.radixTrailing=true;return;}
   const digit=Number.parseInt(char,36);
   if(this.radixTrailing||!Number.isInteger(digit)||digit>=this.radix){this.radixInvalid=true;return;}
   if(digit||this.radixDigits){this.radixDigits++;if(this.radixPrefix.length<1100)this.radixPrefix+=char;}
   else if(!this.radixPrefix)this.radixPrefix="0";
   return;
  }
  if(this.phase==="number"){
   if(char>="0"&&char<="9"){
    this.digits++;if(this.fraction)this.fractionDigits++;
    if(char!=="0"||this.significant){this.significant++;if(this.prefix.length<1100)this.prefix+=char;else if(char!=="0")this.sticky=true;}
    return;
   }
   if(char==="."&&!this.fraction){this.fraction=true;return;}
   if(this.digits===1&&!this.fraction&&!this.significant&&!this.signed){
    const radix=({x:16,X:16,b:2,B:2,o:8,O:8} as Record<string,number>)[char];
    if(radix){this.radix=radix;this.phase="radix";return;}
   }
   if((char==="e"||char==="E")&&this.digits){this.hadExponent=true;this.phase="exponentStart";return;}
   this.special=!this.digits&&!this.fraction&&char==="I";this.phase="suffix";
  }
  if(this.phase==="exponentStart"){
   this.phase="exponent";
   if(char==="+"||char==="-"){this.exponentNegative=char==="-";return;}
  }
  if(this.phase==="exponent"){
   if(char>="0"&&char<="9"){this.exponentDigits++;if(this.exponent<exponentBound){const next=this.exponent*10n+BigInt(char.charCodeAt(0)-48);this.exponent=next>exponentBound?exponentBound:next;}return;}
   this.phase="suffix";
  }
  if(!char.trim()){if(this.special&&this.suffix.length<8)this.specialInvalid=true;this.suffixSpace=true;return;}
  if(this.suffixSpace)this.suffixInvalid=true;
  if(this.suffix.length<9)this.suffix+=char;else this.suffixInvalid=true;
 }

 value(mode:"float"|"number"):number {
  if(mode==="number"&&this.phase==="start")return 0;
  if(this.radix){
   if(mode==="float")return 0;
   if(this.radixInvalid||!this.radixPrefix)return NaN;
   if(this.radixDigits>1100)return Infinity;
   return Number((this.radix===16?"0x":this.radix===8?"0o":"0b")+this.radixPrefix);
  }
  if(this.special){
   const valid=mode==="float"?this.suffix.startsWith("Infinity")&&!this.specialInvalid:this.suffix==="Infinity"&&!this.suffixInvalid;
   return valid?(this.negative?-Infinity:Infinity):NaN;
  }
  if(!this.digits||mode==="number"&&(this.suffix.length>0||this.suffixInvalid||this.hadExponent&&!this.exponentDigits))return NaN;
  const coefficient=this.prefix+(this.sticky?"1":""),power=(this.exponentNegative?-this.exponent:this.exponent)-BigInt(this.fractionDigits)+BigInt(this.significant)-BigInt(coefficient.length);
  return this.prefix?Number((this.negative?"-":"")+coefficient+"e"+power):this.negative?-0:0;
 }

 unit():string|undefined {
  return !this.hadExponent&&!this.radix&&!this.suffixInvalid&&["","px","pt","pc","mm","cm","in","%"].includes(this.suffix.toLowerCase())?this.suffix.toLowerCase():undefined;
 }
}

export function scaleSvgNumber(value:number,unit:string|undefined,reference:number):number {
 switch(unit){
  case "in":return value*72;
  case "cm":return value*72/2.54;
  case "mm":return value*72/25.4;
  case "pc":return value*12;
  case "%":return value/100*reference;
  default:return value;
 }
}

export function parseSvgNumber(val: string | undefined, fallback: number): number {
  const value = parseSvgCoord(val, fallback, fallback);
  return value > 0 ? value : fallback;
}

export function parseSvgCoord(val: string | undefined, fallback: number, refSize = 0): number {
  if (!val) return fallback;
  const trimmed = val.trim();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|pt|pc|mm|cm|in|%)?$/i.exec(trimmed);
  if (!match) {
    const num = parseFloat(trimmed);
    return Number.isFinite(num) ? num : fallback;
  }
  const num = parseFloat(match[1]!);
  if (!Number.isFinite(num)) return fallback;
  const unit = (match[2] ?? "px").toLowerCase();
  return scaleSvgNumber(num, unit, refSize);
}
