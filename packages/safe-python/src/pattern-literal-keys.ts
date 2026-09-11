import type { Expression } from "./ast.js";
import type { SourceMeter } from "./source.js";
import { integerDigits } from "./runtime/integer-digits.js";
import { integerBitMetric } from "./runtime/integer-bit-metric.js";

type NumericConstant = { real: bigint | number; imaginary: number };

/** Equality keys for literal mapping patterns, never for dynamic attribute lookups.
 * Host BigInt size inspection inherits integerBitMetric's temporary-hex
 * accounting limitation; the subsequent decimal conversion is reserved first. */
export function patternLiteralKey(expression: Expression, meter?: SourceMeter): string | undefined {
  try {
  meter?.checkpoint();
  if (expression.kind === "literal") {
    if (expression.literalKind === "none") return "none";
    if (expression.value instanceof Uint32Array) {
      meter?.checkpoint(1+expression.value.length,96+100*expression.value.length);
      return `string:${expression.value.join(",")}`;
    }
    if (expression.value instanceof Uint8Array) {
      meter?.checkpoint(1+expression.value.length,96+56*expression.value.length);
      return `bytes:${expression.value.join(",")}`;
    }
  }
  const numeric = numericConstant(expression,meter);
  if (!numeric) return undefined;
  // Integral floats share Python equality with their exact integer value, not a
  // rounded conversion of the other integer operand to JavaScript Number.
  meter?.checkpoint(1,160);
  const integer = typeof numeric.real === "number" && Number.isInteger(numeric.real) ? BigInt(numeric.real) : numeric.real;
  const real = typeof integer==="bigint"&&meter ? integerDigits(integer,10,meter,0) : String(integer);
  meter?.checkpoint(1+real.length,128+2*real.length);
  return numeric.imaginary === 0 ? `number:${real}` : `complex:${real}:${numeric.imaginary}`;
  } finally {meter?.checkpoint();}
}

function numericConstant(expression: Expression,meter?:SourceMeter): NumericConstant | undefined {
  meter?.checkpoint(1,112);
  const pending:Array<{expression:Expression;state:number;left?:NumericConstant}>=[{expression,state:0}];
  let result:NumericConstant|undefined;
  while(pending.length){
  meter?.checkpoint();
  const frame=pending[pending.length-1];
  expression=frame.expression;
  if(frame.state===0){
  result=undefined;
  if (expression.kind === "literal") {
    meter?.checkpoint(0,48);
    if (typeof expression.value === "bigint") result={ real: expression.value, imaginary: 0 };
    else if (typeof expression.value === "boolean") result={ real: Number(expression.value), imaginary: 0 };
    else if (typeof expression.value === "number") result=expression.literalKind === "imaginary"
      ? { real: 0, imaginary: expression.value } : { real: expression.value, imaginary: 0 };
    pending.pop();continue;
  }
  if (expression.kind === "unary" && expression.operator === "-") {
    frame.state=1;meter?.checkpoint(0,80);pending.push({expression:expression.operand,state:0});continue;
  }
  if (expression.kind === "binary" && (expression.operator === "+" || expression.operator === "-")) {
    frame.state=1;meter?.checkpoint(0,80);pending.push({expression:expression.left,state:0});continue;
  }
  pending.pop();continue;
  }
  if(expression.kind==="unary"){
    if(result){
      if(typeof result.real==="bigint"&&meter){const bits=integerBitMetric(result.real,"bit_length",meter);meter.checkpoint(1+Math.ceil(bits/64),32+Math.ceil(bits/8));}
      meter?.checkpoint(0,48);result={real:-result.real,imaginary:-result.imaginary};
    }
    pending.pop();continue;
  }
  if(expression.kind==="binary"){
    if(frame.state===1){frame.left=result;frame.state=2;meter?.checkpoint(0,80);pending.push({expression:expression.right,state:0});continue;}
    const left=frame.left,right=result;
    result=undefined;
    if (left && right) {
      // Combining real and imaginary literals produces a double-precision complex
      // constant in Python, including conversion of an arbitrary-precision real.
      if(meter){
        if(typeof left.real==="bigint")meter.checkpoint(1+integerBitMetric(left.real,"bit_length",meter));
        if(typeof right.real==="bigint")meter.checkpoint(1+integerBitMetric(right.real,"bit_length",meter));
      }
      meter?.checkpoint(0,48);
      result=expression.operator === "+"
        ? { real: Number(left.real) + Number(right.real), imaginary: left.imaginary + right.imaginary }
        : { real: Number(left.real) - Number(right.real), imaginary: left.imaginary - right.imaginary };
    }
  }
  pending.pop();
  }
  return result;
}
