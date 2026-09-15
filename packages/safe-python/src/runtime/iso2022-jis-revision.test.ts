import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import oracle from './__snapshots__/iso2022-jis-revision-oracle.json';
import {iso2022Jp3Codec,iso2022Jp2004Codec} from './iso2022-jis-revision-codec.js';
import {CodePointString} from './code-point-string.js';
import {DoubleByteIncrementalEncoder} from './double-byte-incremental-encoder.js';
import {DoubleByteIncrementalDecoder} from './double-byte-incremental-decoder.js';
import {PythonEncodeError} from './encode-error.js';
import {PythonDecodeError} from './decode-error.js';
import {PythonRuntimeError} from './error.js';
import {ExecutionBudget,ExecutionLimitError} from './execution-budget.js';

function outcome(run:()=>Uint8Array|CodePointString):unknown {
  try{return ['ok',[...run()]];}
  catch(error){
    if(error instanceof PythonEncodeError||error instanceof PythonDecodeError)return ['error',error.name,error.start,error.end,error.reason];
    if(error instanceof PythonRuntimeError)return ['error',error.name,error.message];
    throw error;
  }
}

for(const codec of [iso2022Jp3Codec,iso2022Jp2004Codec]){
  const reference=oracle.codecs.find(row=>row.name===codec.name)!;
  describe(codec.name,()=>{
    it.each(reference.encode)('matches all scalar encodings in block %i', (start,digest)=>{
      const hash=createHash('sha256');
      for(let point=Number(start);point<Number(start)+1024;point++){
        const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
        hash.update(JSON.stringify(outcome(()=>codec.encode(CodePointString.fromString(String.fromCodePoint(point),meter),'strict',meter)))+'\n');
      }
      expect(hash.digest('hex')).toBe(digest);
    });
    it.each(reference.decode)('matches designated byte matrix %i/%i',(mark,first,digest)=>{
      const hash=createHash('sha256');
      for(let second=0;second<256;second++){
        const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
        hash.update(JSON.stringify(outcome(()=>codec.decode(Uint8Array.of(27,36,40,Number(mark),Number(first),second),'strict',meter).text))+'\n');
      }
      expect(hash.digest('hex')).toBe(digest);
    });
    it.each(reference.incremental)('preserves $kind state at split $split ($errors): $input',row=>{
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const errors=row.errors as 'strict'|'replace'|'ignore';
      const encoder=new DoubleByteIncrementalEncoder(codec,errors),decoder=new DoubleByteIncrementalDecoder(codec,errors);
      const parts=[row.input.slice(0,row.split),row.input.slice(row.split),[]];
      const steps=parts.map((points,index)=>{
        const result=outcome(()=>row.kind==='encode'?encoder.encode(new CodePointString(Uint32Array.from(points),meter),index!==0,meter):decoder.decode(Uint8Array.from(points),index!==0,meter));
        const state=decoder.getstate(meter);
        return [result,row.kind==='encode'?String(encoder.getstate(meter)):[[...state[0]],String(state[1])]];
      });
      expect(steps).toEqual(row.steps);
    });
    it.each(reference.recovery)('preserves $operation recovery $action',row=>{
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const text=(value:string)=>CodePointString.fromString(value,meter);
      const encoder=new DoubleByteIncrementalEncoder(codec),decoder=new DoubleByteIncrementalDecoder(codec);
      const instance=row.operation==='encode'?encoder:decoder,seen:unknown[]=[];
      const recover=(error:PythonEncodeError|PythonDecodeError)=>{
        seen.push([error.encoding,[...error.object],error.start,error.end,error.reason]);
        if(row.action==='raise')throw new PythonRuntimeError('ValueError','guest failure');
        if(row.action==='mutate')instance.errors='ignore';
        if(row.action==='reset')instance.reset(meter);
        if(row.action==='nested')seen.push(['nested',outcome(()=>row.operation==='encode'?encoder.encode(text('か\u309a'),false,meter):decoder.decode(Uint8Array.of(27,36,40,codec.name==='iso2022_jp_3'?79:81,36,119),false,meter))]);
        return {replacement:text(row.operation==='encode'?'か\u309a':'R'),position:row.action==='past'?BigInt(error.object.length+1):-1n};
      };
      encoder.errors=recover;decoder.errors=recover;
      const result=outcome(()=>row.operation==='encode'?encoder.encode(new CodePointString(Uint32Array.from(row.input),meter),true,meter):decoder.decode(Uint8Array.from(row.input),true,meter));
      const state=decoder.getstate(meter);
      expect({seen,result,state:row.operation==='encode'?String(encoder.getstate(meter)):[[...state[0]],String(state[1])]}).toEqual({seen:row.seen,result:row.result,state:row.state});
    });
    it.each(reference.restored)('retains restored $operation state $state',row=>{
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const encoder=new DoubleByteIncrementalEncoder(codec,'replace'),decoder=new DoubleByteIncrementalDecoder(codec,'replace');
      if(row.operation==='encode')encoder.setstate(BigInt(row.state as string),meter);
      else{
        const state=row.state as [number[],string];
        decoder.setstate([Uint8Array.from(state[0]),BigInt(state[1])],meter);
      }
      const result=outcome(()=>row.operation==='encode'?encoder.encode(new CodePointString(Uint32Array.from(row.input),meter),true,meter):decoder.decode(Uint8Array.from(row.input),true,meter));
      const serial=()=>{
        if(row.operation==='encode')return String(encoder.getstate(meter));
        const state=decoder.getstate(meter);return [[...state[0]],String(state[1])];
      };
      const after=serial();
      if(row.operation==='encode')encoder.reset(meter);else decoder.reset(meter);
      expect({result,after,reset:serial()}).toEqual({result:row.result,after:row.after,reset:row.reset});
    });
    it.each([false,true])('keeps callback cancellation terminal (throws=%s)',throws=>{
      for(const operation of ['encode','decode']){
        const controller=new AbortController(),meter=new ExecutionBudget({signal:controller.signal,maxSteps:10000,maxAllocatedBytes:100000});
        const encoder=new DoubleByteIncrementalEncoder(codec),decoder=new DoubleByteIncrementalDecoder(codec);
        const replacement=CodePointString.fromString('R',meter);
        const recovery=()=>{
          controller.abort();
          if(throws)throw new PythonRuntimeError('ValueError','guest failure');
          return {replacement,position:-1n};
        };
        encoder.errors=recovery;decoder.errors=recovery;
        expect(()=>operation==='encode'?encoder.encode(CodePointString.fromString('\ud800A',meter),true,meter):decoder.decode(Uint8Array.of(255,65),true,meter)).toThrow(expect.objectContaining({reason:'cancelled'}));
        for(const instance of [encoder,decoder]){
          expect(()=>instance.getstate(meter)).toThrow(ExecutionLimitError);
          expect(()=>instance.reset(meter)).toThrow(ExecutionLimitError);
        }
      }
    });
  });
}
