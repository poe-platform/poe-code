import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {taiwanCodecs} from "./taiwan-codec.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";

const meter=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:16000000});
// Independent CPython 3.14.7, Unicode 16.0.0 oracle; each mapping is an int32
// little-endian value in input order, with -1 for an unencodable/unmapped input.
const references=[
  {name:"big5",decodeCount:13710,decode:"c5ccb81e8ad01f6e5335e50b22c97340fb693227e35b972bd9972f4e655051c0",encodeCount:13834,encode:"9e86da4f0bdfd7c4ac218e1f696217b766de2ff618d07a07f3367cdd1ea894da",policies:[
    ["strict","a259184d2d758c5d89dee58e78054b27698a060982134d84785b333692331395","fed84834ceb1687f314166eb8f44992e4c24837a9cbc4d7ed23fc8fe863cc6e0"],
    ["ignore","a58141b02b1524e10acafb923a41e50661921d51fc8c8e9ac5a2eb96a9ceb452","e3a0f49bdf8be4c95b763732c7767d1dccb4df3dcc5e1e432ea2be9968876907"],
    ["replace","dda1c25fb614df6e7b71830878a194bb1b5cfc0c5fc861f197c3d1180c5d3e1d","ffaa2ce0155d7638be6d02ab3a964d2e858cf3e95b6d2122ebe2133c76fdcd6c"]
  ],encoded:[["ignore",27540,"88ff5663875e61ad07ef41efe9a7fa1f1cdad307a822278a66cfcbd2165220c7"],["replace",1127818,"74c533c2b22c2bf86462319508548213db2a19a24a2f4148178376d50a5e8169"]]},
  {name:"cp950",decodeCount:13752,decode:"a481eb297c2542760ebc60e4f3842a4814c1497a6447fb3d7c673b4f0ddf9ce6",encodeCount:13879,encode:"ed37b86afe489050b07478340717b7133d60ecf92b8f8724d98bb5fcea38032d",policies:[
    ["strict","a6259a282a91bef77bbbb9ee7e276c7fc3a3571fe2f604068ead8a80d22a30be","568b3196547e07c2b4975d3fd102c9976624ae93bd82219c093a91068945ffa5"],
    ["ignore","b1baaf4fd3698a1a635664dcb94b7997df287111a1cc17b527849895ead73bfa","e1e4206f350cfa1bfcd51f53bb55b55e7c7d452312d0da3032888744dbaff5af"],
    ["replace","3ccd1cde0ada37b406948db87ed21564862680ed76fb333ea74db020b0b7427a","9798c54d453a628bb5a97e846af640b36aefd409901d9a849a3d9b5ff7e2ed18"]
  ],encoded:[["ignore",27630,"bfcbd70da309ab71271d0f7efdd380cdd19623a3ad72a3252f7327530d4e1efe"],["replace",1127863,"68522fe9b73ed3fc9cf8ce93ab11dca92a7725949eb30890577ed6e82e8d2249"]]}
] as const;

for(const reference of references){
  it(`${reference.name} matches all byte pairs and Unicode mapping inputs`,()=>{
    const codec=taiwanCodecs[reference.name],budget=meter();
    const decoded=Buffer.alloc(32768*4),encoded=Buffer.alloc(0x110000*4);
    let decodeCount=0,encodeCount=0;
    for(let first=128;first<256;first++)for(let second=0;second<256;second++){
      const value=codec.lookupPair(first,second,budget);
      if(value!==undefined)decodeCount++;
      decoded.writeInt32LE(value??-1,((first-128)*256+second)*4);
    }
    const mappingBudget=new ExecutionBudget({maxSteps:4000000,maxAllocatedBytes:16000000});
    for(let point=0;point<0x110000;point++){
      const value=codec.lookupCharacter(point,mappingBudget);
      if(value!==undefined)encodeCount++;
      encoded.writeInt32LE(value??-1,point*4);
    }
    expect([decodeCount,encodeCount]).toEqual([reference.decodeCount,reference.encodeCount]);
    expect(createHash("sha256").update(decoded).digest("hex")).toBe(reference.decode);
    expect(createHash("sha256").update(encoded).digest("hex")).toBe(reference.encode);
  });

  it.each(reference.policies)(`${reference.name} matches all pairs and split states with %s`,(errors,digest,splitDigest)=>{
    const codec=taiwanCodecs[reference.name],hash=createHash("sha256"),splitHash=createHash("sha256");
    for(let first=128;first<256;first++)for(let second=0;second<256;second++){
      const input=Uint8Array.of(first,second);
      let row:unknown[];
      try{const result=codec.decode(input,errors,meter());row=["ok",[...result.text],result.consumed];}
      catch(error){
        if(!(error instanceof PythonDecodeError))throw error;
        expect(error.encoding).toBe(reference.name);
        row=["error",error.start,error.end,error.reason];
      }
      hash.update(JSON.stringify(row)+"\n");
      const decoder=new DoubleByteIncrementalDecoder(codec,errors),firstOutput=decoder.decode(input.subarray(0,1),false,meter());
      try{row=["ok",[...firstOutput],[...decoder.decode(input.subarray(1),true,meter())]];}
      catch(error){
        if(!(error instanceof PythonDecodeError))throw error;
        row=["error",[...firstOutput],error.start,error.end,error.reason];
      }
      const [pending,state]=decoder.getstate(meter());row.push([...pending],String(state));
      splitHash.update(JSON.stringify(row)+"\n");
    }
    expect(hash.digest("hex")).toBe(digest);
    expect(splitHash.digest("hex")).toBe(splitDigest);
  });

  it.each(reference.encoded)(`${reference.name} encodes all Unicode inputs with %s`,(errors,length,digest)=>{
    const budget=new ExecutionBudget({maxSteps:16000000,maxAllocatedBytes:64000000});
    const input=new CodePointString(Uint32Array.from({length:0x110000},(_,point)=>point),budget);
    const result=taiwanCodecs[reference.name].encode(input,errors,budget);
    expect(result.length).toBe(length);
    expect(createHash("sha256").update(result).digest("hex")).toBe(digest);
  });

  it(`${reference.name} recovers surrogates and negative positions without replacing active input`,()=>{
    const codec=taiwanCodecs[reference.name],input=new CodePointString(Uint32Array.of(0xd800,0xdc80,0x1f600,65)),seen:number[]=[];
    expect([...codec.encode(input,error=>{
      expect(error.object).toBe(input);seen.push(error.start);
      return {replacement:Uint8Array.of(63),position:BigInt(error.end)};
    },meter())]).toEqual([63,63,63,65]);
    expect(seen).toEqual([0,1,2]);
    const bytes=Uint8Array.of(255,65);
    expect([...codec.decode(bytes,error=>{
      error.object.fill(66);
      return {replacement:CodePointString.fromString("?",meter()),position:-1n};
    },meter()).text]).toEqual([63,65]);
    expect([...bytes]).toEqual([255,65]);
  });

  it.each([false,true])(`${reference.name} cancellation wins after callback return/failure (%s)`,throws=>{
    for(const operation of ["encode","decode"]){
      const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:16000,signal:controller.signal});
      const codec=taiwanCodecs[reference.name],failure=new Error("guest failure");
      const recover=()=>{controller.abort();if(throws)throw failure;return {replacement:CodePointString.fromString("?",meter()),position:1n};};
      expect(()=>operation==="encode"?codec.encode(CodePointString.fromString("😀",meter()),recover,budget):codec.decode(Uint8Array.of(255),recover,budget)).toThrow(expect.objectContaining({reason:"cancelled"}));
      expect(()=>codec.decode(new Uint8Array(),"strict",budget)).toThrow(ExecutionLimitError);
    }
  });
}
