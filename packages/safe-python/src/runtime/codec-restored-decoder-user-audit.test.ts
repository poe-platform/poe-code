import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import evidence from "./__snapshots__/codec-restored-decoder-user-audit.json";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";
import {cp932Codec} from "./cp932-codec.js";
import {eucJpCodec} from "./euc-jp-codec.js";
import {gbkCodec} from "./gbk-codec.js";

const codecs=[hzCodec,iso2022JpCodec,iso2022KrCodec,cp932Codec,eucJpCodec,gbkCodec];
const alphabet=[0,10,13,14,15,27,36,40,41,66,67,73,74,79,80,81,86,92,126,123,125,127,128,129,161,254,255];
let seed=314716;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
const cases=codecs.flatMap(codec=>Array.from({length:2000},()=>{
  const data=Array.from({length:random()%45},()=>alphabet[random()%alphabet.length]);
  const split=random()%(data.length+1);
  const pending=Array.from({length:random()%9},()=>alphabet[random()%alphabet.length]);
  const state=codec===hzCodec?BigInt(random()%256):(codec.shift?.decoderInitialState??0n);
  return {name:codec.name,errors:(["strict","replace","ignore"] as const)[random()%3],pending,state:String(state),
    chunks:[data.slice(0,split),data.slice(split),[],[65]],final:[false,false,true,true]};
}));

it("retains the pinned reference and every restored-state corpus row",()=>{
  expect(evidence.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(evidence.reference).toMatchObject({unicode:"16.0.0",platform:"darwin",byteorder:"little"});
  expect(evidence.seed).toBe(314716);
  expect(evidence.cases).toBe(12000);
  expect(evidence.calls).toBe(48000);
  expect(evidence.mismatches).toBe(0);
  expect(evidence.groups).toHaveLength(120);
  expect(evidence.groups.map(group=>group.start)).toEqual(Array.from({length:120},(_,index)=>index*100));
  expect(evidence.groups.every(group=>group.count===100)).toBe(true);
  expect(cases).toHaveLength(evidence.cases);
});

// Each bounded group preserves the complete output/error and state after all
// four calls. Failed streams are continued, not removed from the comparison.
it.each(evidence.groups)("matches CPython restored $name decoder rows at $start",group=>{
  const rows=cases.slice(group.start,group.start+group.count);
  expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe(group.inputSha256);
  const records=rows.map(row=>{
    const codec=codecs.find(codec=>codec.name===row.name)!;
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    const decoder=new DoubleByteIncrementalDecoder(codec,row.errors);
    decoder.setstate([Uint8Array.from(row.pending),BigInt(row.state)],meter);
    return row.chunks.map((chunk,index)=>{
      let result:unknown;
      try{result=["ok",[...decoder.decode(Uint8Array.from(chunk),row.final[index],meter)]];}
      catch(error){
        if(!(error instanceof PythonDecodeError))throw error;
        result=["error",error.encoding,[...error.object],error.start,error.end,error.reason];
      }
      const [pending,state]=decoder.getstate(meter);
      return [result,[[...pending],String(state)]];
    });
  });
  expect(createHash("sha256").update(JSON.stringify(records)).digest("hex")).toBe(group.resultSha256);
});
