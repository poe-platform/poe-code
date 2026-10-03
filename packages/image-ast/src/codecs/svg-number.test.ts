import {expect,test} from "vitest";
import {SvgNumber} from "./svg-number.js";

const tokens=[""," ","+","-",".","+.5","1.","1e","1e+","1e-","1e+2e3","1e+-3","12cm","12 cm","0x10","-0x10","0b101","0o17","0x","0x00","0b2","0x1 0","Infinity","-Infinity","I nfinity",".Infinity","Infinity suffix",".000","000012","1.00000000000000011102230246251565404236316680908203125","1.00000000000000011102230246251565404236316680908203125"+"0".repeat(2000)+"1","0."+"0".repeat(10000)+"12e10002","1e"+"9".repeat(10000),"0b"+"0".repeat(10000)+"1"];
for(const token of tokens)test(`matches native numeric prefixes and complete tokens: ${token.slice(0,60)}`,()=>{
 const parsed=new SvgNumber();for(const char of token)parsed.accept(char);
 expect(parsed.value("float")).toBe(Number.parseFloat(token));expect(parsed.value("number")).toBe(Number(token));
});
