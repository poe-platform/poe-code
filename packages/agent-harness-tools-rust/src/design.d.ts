export interface SelectOptions<Value> {
 message:string;
 options:{value:Value;label:string;hint?:string}[];
 initialValue?:Value;
 maxItems?:number;
 signal?:AbortSignal;
 input?:NodeJS.ReadableStream;
 output?:NodeJS.WritableStream;
}
export function select<Value>(options:SelectOptions<Value>):Promise<Value|symbol>;
export function isCancel(value:unknown):value is symbol;
