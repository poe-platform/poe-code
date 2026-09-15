import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {gbkCodec} from "./gbk-codec.js";
import {hzCodec} from "./hz-codec.js";

// Independent CPython 3.14.7 oracle source and ordering are retained in
// __snapshots__/codec-packed-state-oracle.json. No oracle runs in unit tests.
const meter=()=>new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});

function failure(error:unknown):unknown[] {
  if(error instanceof PythonDecodeError)return [error.name,error.encoding,[...error.object],error.start,error.end,error.reason];
  if(error instanceof PythonRuntimeError)return [error.name,error.message];
  throw error;
}

it("preserves encoder state on every two-byte UTF-8 state validation failure",()=>{
  const hash=createHash("sha256"),encoder=new DoubleByteIncrementalEncoder(gbkCodec);
  let count=0;
  const record=(state:bigint)=>{
    const budget=meter();
    encoder.setstate(0x13425a01n,budget);
    let result:unknown[];
    try{encoder.setstate(state,budget);result=["ok"];}
    catch(error){result=failure(error);}
    hash.update(JSON.stringify([String(state),result,String(encoder.getstate(budget))])+"\n");
    count++;
  };
  const packed=(bytes:readonly number[])=>{
    let state=0xf0debc9a78563412n;
    for(let index=bytes.length-1;index>=0;index--)state=(state<<8n)|BigInt(bytes[index]);
    record((state<<8n)|BigInt(bytes.length));
  };
  for(let first=0;first<256;first++)for(let second=0;second<256;second++)packed([first,second]);
  for(const bytes of [
    [0xed,0xa0,0x80],[0xed,0xbf,0xbf],[0xf0,0x90,0x80,0x80],[0xf4,0x8f,0xbf,0xbf],
    [0xf4,0x90,0x80,0x80],[0xe0,0x80,0x80],[0xc0,0xaf],[0xf0,0x80,0x80,0x80],
    [0xe2,0x82],[0xf0,0x9f,0x98],[0,0,0,0,0,0,0,0]
  ])packed(bytes);
  for(const state of [-1n,1n<<136n,(1n<<136n)-1n,9n,255n])record(state);
  expect(count).toBe(65552);
  expect(hash.digest("hex")).toBe("c842567672010504cad8efccaebd45412c05c1c68c0f0425ae08f5d84d2ecd74");
});

it("matches all HZ mode bytes with pending input, finalization, failures and reset",()=>{
  const hash=createHash("sha256");let count=0;
  for(let mode=0;mode<256;mode++)for(const original of [[],[126],[86]]){
    for(const data of [[],[65],[86,80],[126,125],[126,123],[126,126],[126,10],[255],[86,255],[126,125,65]]){
      for(const final of [false,true]){
        const budget=meter(),decoder=new DoubleByteIncrementalDecoder(hzCodec);
        decoder.setstate([Uint8Array.from(original),BigInt(0x123400|mode)],budget);
        let result:unknown[];
        try{result=["ok",[...decoder.decode(Uint8Array.from(data),final,budget)]];}
        catch(error){result=failure(error);}
        const state=decoder.getstate(budget);
        decoder.reset(budget);
        const reset=decoder.getstate(budget);
        hash.update(JSON.stringify([mode,original,data,final,result,[[...state[0]],String(state[1])],[[...reset[0]],String(reset[1])]])+"\n");
        count++;
      }
    }
  }
  expect(count).toBe(15360);
  expect(hash.digest("hex")).toBe("89d3eee3799d3a6a163a4504bee02872432fca27750318da8e1e9a789ff56071");
});
