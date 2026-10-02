import assert from "node:assert/strict";
import test from "node:test";
import {original} from "./cli-json-errors-reference.mjs";
const native=()=>import("../dist/cli-json-errors.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("JSON error locations preserve cause, direct-offset and message precedence",async()=>{
  const api=await native(),source='{\n  "😀": 1,\n  bad\n}';
  for(const error of [null,undefined,17,"bad at position 8",new Error("bad at position 8 (line 2 column 7)"),{cause:{line:3,column:4},position:1},{cause:{line:2,col:3}},{cause:{line:2,column:NaN,col:4},position:10},{cause:{line:2,column:0}},{position:4.8},{position:-2},{position:Infinity},Object.create({position:3}),{cause:null,position:3}])assert.deepEqual(api.getJsonParseErrorLocation(error,source),original.getJsonParseErrorLocation(error,source));
  for(const value of [null,undefined,{},[],()=>1,Object.create({position:2}),{position:0},{position:NaN},{position:Infinity},{position:"2"}])assert.deepEqual(api.getNumericProperty(value,"position"),original.getNumericProperty(value,"position"));
});

test("JSON offset and message scanning preserve UTF-16 and numeric edge cases",async()=>{
  const api=await native();
  for(const source of ["","abc","a\r\nb\nc","😀\ud800\nnext"])for(const offset of [-Infinity,-1,-0,0,1,2,2.9,10,Infinity,NaN,"3",null])assert.deepEqual(api.getSourceOffsetLocation(source,offset),original.getSourceOffsetLocation(source,offset));
  for(const message of ["","bad","bad at position ","bad at position 12 then 17","bad at position -3","bad at position 1.5","bad at position １","bad at position 99999999999999999999","bad at position 0 (line 1 column 1)"])assert.equal(api.getJsonParseMessagePosition(message),original.getJsonParseMessagePosition(message));
  for(const message of ["bad","bad (line 2 column 3)","bad (line 2 column 3) extra"])assert.equal(api.removeNativeJsonParseLocation(message,{line:2,column:3}),original.removeNativeJsonParseLocation(message,{line:2,column:3}));
});

test("JSON file diagnostics preserve path quoting, suffixes and source snippets",async()=>{
  const api=await native(),source='{\n  "name": "😀",\n  bad\n}';
  for(const error of [new Error("unexpected token at position 20 (line 3 column 3)"),new Error("unexpected token",{cause:{line:3,column:3}}),new Error("unexpected end"),{position:20},null])for(const quotePath of [false,true])assert.equal(api.formatJsonParseUserErrorMessage("Preset","config.json",source,error,{quotePath}),original.formatJsonParseUserErrorMessage("Preset","config.json",source,error,{quotePath}));
});

test("JSON location detection preserves descriptor, getter and coercion order",async()=>{
  const api=await native();
  function run(module,withCause){
    const trace=[];
    const tracked=(name,value)=>new Proxy(value,{get(target,key){trace.push(["get",name,key]);return target[key];},getOwnPropertyDescriptor(target,key){trace.push(["own",name,key]);return Object.getOwnPropertyDescriptor(target,key);}});
    const error=tracked("error",{cause:withCause?tracked("cause",{line:2,col:3}):undefined,position:3});
    return {value:module.getJsonParseErrorLocation(error,"a\nbc"),trace};
  }
  for(const cause of [false,true])assert.deepEqual(run(api,cause),run(original,cause));
  for(const module of [original,api])for(const failure of [undefined,null,false,17,Symbol("failure")])assert.throws(()=>module.getJsonParseErrorLocation({get cause(){throw failure;}},"text"),error=>error===failure);
});

test("JSON numeric properties use live ownership and finite predicates",async()=>{
  const api=await native();
  function run(module){
    const trace=[],value={position:Infinity};
    const own=Object.prototype.hasOwnProperty,finite=Number.isFinite;
    try{
      Object.prototype.hasOwnProperty=function(key){if(this===value){trace.push(["own",key]);return "present";}return own.call(this,key);};
      Number.isFinite=function(number){trace.push(["finite",this===Number,number]);return {accepted:true};};
      return {value:module.getNumericProperty(value,"position"),trace};
    }finally{Object.prototype.hasOwnProperty=own;Number.isFinite=finite;}
  }
  assert.deepEqual(run(api),run(original));
});

test("JSON message scanning preserves method lookup and digit coercion",async()=>{
  const api=await native();
  function run(module,index){
    const trace=[],parseInt=Object.getOwnPropertyDescriptor(Number,"parseInt");
    const message={
      length:14,
      indexOf(marker){trace.push(["indexOf",this===message,marker]);return index;},
      get 13(){trace.push(["digit"]);return {[Symbol.toPrimitive](hint){trace.push(["coerce",hint]);return "5";}};},
      get slice(){trace.push(["slice-get"]);Object.defineProperty(Number,"parseInt",{...parseInt,value:()=>"late"});return function(start,end){trace.push(["slice",this===message,start,end]);return "5";};}
    };
    try{
      Object.defineProperty(Number,"parseInt",{configurable:true,get(){trace.push(["parseInt-get"]);return function(value,radix){trace.push(["parseInt",this===Number,value,radix]);return {parsed:5};};}});
      return {value:module.getJsonParseMessagePosition(message),trace};
    }finally{Object.defineProperty(Number,"parseInt",parseInt);}
  }
  for(const index of [0,NaN,"",-1])assert.deepEqual(run(api,index),run(original,index));
  for(const module of [api,original]){
    let calls=0;
    assert.equal(module.isAsciiDigit({[Symbol.toPrimitive](){return ++calls===1?"4":"8";}}),true);
    assert.equal(calls,2);
  }
});

test("JSON source offsets preserve live math, source access and reentrancy",async()=>{
  const api=await native();
  function run(module){
    const trace=[],floor=Object.getOwnPropertyDescriptor(Math,"floor"),max=Object.getOwnPropertyDescriptor(Math,"max");
    const source=new Proxy({0:"a",1:"\n",2:"😀",length:3},{get(target,key){trace.push(["source",key]);return target[key];}});
    try{
      Object.defineProperty(Math,"max",{configurable:true,get(){trace.push(["max-get"]);return function(...values){trace.push(["max",this===Math,values]);return 3;};}});
      Object.defineProperty(Math,"floor",{configurable:true,get(){trace.push(["floor-get"]);return function(value){trace.push(["floor",this===Math,value]);return 2;};}});
      return {value:module.getSourceOffsetLocation(source,2.5),trace};
    }finally{Object.defineProperty(Math,"floor",floor);Object.defineProperty(Math,"max",max);}
  }
  assert.deepEqual(run(api),run(original));
  for(const module of [api,original]){
    const nested=[];
    const result=module.getSourceOffsetLocation({get length(){nested.push(module.getSourceOffsetLocation("a\nb",3));return 1;},0:"x"},2);
    assert.deepEqual(result,{line:1,column:2});
    assert.deepEqual(nested,[{line:2,column:2},{line:2,column:2}]);
  }
});

test("JSON diagnostics preserve path, label and source coercion order",async()=>{
  const api=await native();
  function run(module,quotePath,position){
    const trace=[];
    const label={[Symbol.toPrimitive](hint){trace.push(["label",hint]);return "Preset";}};
    const path={[Symbol.toPrimitive](hint){trace.push(["path",hint]);return "preset.json";}};
    const error=new Error("broken");
    if(position)error.cause={line:1,column:2};
    const options={get quotePath(){trace.push(["quotePath"]);return quotePath;}};
    return {result:outcome(()=>module.formatJsonParseUserErrorMessage(label,path,"{bad}",error,options)),trace};
  }
  for(const quoted of [false,true])for(const position of [false,true])assert.deepEqual(run(api,quoted,position),run(original,quoted,position));
});

test("JSON diagnostic helpers preserve malformed inputs and arbitrary thrown values",async()=>{
  const api=await native();
  const cases=[
    module=>module.getJsonParseMessagePosition(null),
    module=>module.getJsonParseMessagePosition({indexOf:0}),
    module=>module.getJsonParseMessagePosition({indexOf:()=>0,length:14,13:"1",slice:false}),
    module=>module.getSourceOffsetLocation(null,1),
    module=>module.getSourceOffsetLocation("a",Symbol("offset")),
    module=>module.removeNativeJsonParseLocation("bad",null),
    module=>module.removeNativeJsonParseLocation({}, {line:1,column:1}),
    module=>module.formatJsonParseUserErrorMessage("Preset","a.json","",null,null)
  ];
  for(const operation of cases)assert.deepEqual(outcome(()=>operation(api)),outcome(()=>operation(original)));
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    assert.throws(()=>module.getJsonParseMessagePosition({indexOf(){throw failure;}}),error=>error===failure);
    assert.throws(()=>module.isAsciiDigit({[Symbol.toPrimitive](){throw failure;}}),error=>error===failure);
  }
});
