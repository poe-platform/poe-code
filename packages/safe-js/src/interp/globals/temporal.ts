import type { Budget } from "../budget.js";
import { validateTemporalStringOffsets } from "../temporal-offset-validation.js";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { accessorAdapter } from "../accessors.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { formatDateLocale } from "../date-locale.js";
import { getFunctionRealmPrototype, registerRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { objectToPrimitive, sandboxNumber } from "../string-coercion.js";
import { createSandboxTemporalInstant, isSandboxTemporalInstant, temporalInstantEpoch } from "../temporal-instant.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxValue } from "../values.js";
import { sandboxBigInt } from "./bigint.js";
import { formatTemporalInstant } from "./temporal-instant-format.js";
import { roundTemporalInstant } from "./temporal-instant-round.js";
import { readTemporalDuration } from "./temporal-duration-input.js";
import { createTemporalDurationConstructor } from "./temporal-duration.js";
import { createTemporalPlainTimeConstructor } from "./temporal-plain-time.js";
import { createTemporalPlainDateTimeConstructor } from "./temporal-plain-date-time.js";
import { createTemporalPlainDateConstructor } from "./temporal-plain-date.js";
import { createTemporalPlainMonthDayConstructor } from "./temporal-plain-month-day.js";
import { createTemporalPlainYearMonthConstructor } from "./temporal-plain-year-month.js";
import { createTemporalZonedDateTimeConstructor } from "./temporal-zoned-date-time.js";
import { differenceTemporalInstant } from "./temporal-instant-difference.js";
import { createSandboxTemporalZonedDateTime, isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import { parseTemporalTimeZoneString } from "../temporal-time-zone-string.js";
import { createTemporalNowNamespace } from "./temporal-now.js";

export function createTemporalGlobal(budget: Budget, clock: SandboxClosure, defaultTimeZone: SandboxClosure) {
  const namespace=createIntrinsicObject();
  const prototype=createIntrinsicObject();
  const durationConstructor=createTemporalDurationConstructor(budget);
  const durationPrototype=Object.getOwnPropertyDescriptor(materializeFunctionProperties(durationConstructor),"prototype")!.value as object;
  const plainTimeConstructor=createTemporalPlainTimeConstructor(budget,durationPrototype);
  const plainTimePrototype=Object.getOwnPropertyDescriptor(materializeFunctionProperties(plainTimeConstructor),"prototype")!.value as object;
  const plainDateTimePrototype=createIntrinsicObject();
  const zonedDateTimePrototype=createIntrinsicObject();
  const plainMonthDayPrototype=createIntrinsicObject();
  const plainYearMonthPrototype=createIntrinsicObject();
  const plainDateConstructor=createTemporalPlainDateConstructor(budget,durationPrototype,plainDateTimePrototype,zonedDateTimePrototype,plainMonthDayPrototype,plainYearMonthPrototype);
  const plainDatePrototype=Object.getOwnPropertyDescriptor(materializeFunctionProperties(plainDateConstructor),"prototype")!.value as object;
  const constructor: SandboxClosure=createSandboxClosure({
    guest:true,sandbox:true,name:"Instant",length:1,
    call:()=>{throw new TypeError("Temporal.Instant requires new.");},
    construct:async ([input],context)=>{
      let result: SandboxValue;
      let selected: SandboxValue;
      const release=retainValues(budget,()=>[input,result,selected]);
      try {
        const epoch=await sandboxBigInt(input,budget,context);
        result=createSandboxTemporalInstant(epoch);
        const target=context?.newTarget??constructor;
        selected=await sandboxGetProperty(target,"prototype",target,budget,context);
        if (selected===null || typeof selected!=="object")
          selected=getFunctionRealmPrototype(target,"Temporal.Instant",prototype);
        setSandboxPrototype(result,selected,budget);
        createDataCheckpoint(budget,context)(result,0,true);
        return result;
      } finally {release();}
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor),"prototype",{value:prototype,writable:false});
  Object.defineProperties(prototype,{
    constructor:{value:constructor,writable:true,configurable:true},
    [Symbol.toStringTag]:{value:"Temporal.Instant",configurable:true}
  });
  const getters: SandboxClosure[]=[];
  const factories: SandboxClosure[]=[];
  const arithmetic: SandboxClosure[]=[];
  for (const name of ["until","since"] as const) {
    const method=createSandboxClosure({guest:true,sandbox:true,name,length:1,
      call:async ([other,options],context)=>{
        const epoch=temporalInstantEpoch(context?.thisValue);
        let result: SandboxValue;
        const release=retainValues(budget,()=>[other,options,result]);
        try {
          const otherEpoch=await toInstantEpoch(other,context);
          result=await differenceTemporalInstant(name,epoch,otherEpoch,options,budget,context);
          setSandboxPrototype(result,durationPrototype,budget);
          createDataCheckpoint(budget,context)(result,0,true);
          return result;
        } finally {release();}
      }});
    Object.defineProperty(prototype,name,{value:method,writable:true,configurable:true});
    arithmetic.push(method);
  }
  for (const name of ["add","subtract"] as const) {
    const method=createSandboxClosure({guest:true,sandbox:true,name,length:1,
      call:async ([input],context)=>{
        const epoch=temporalInstantEpoch(context?.thisValue);
        const duration=await readTemporalDuration(input,budget,context);
        if (duration.years!==0 || duration.months!==0 || duration.weeks!==0 || duration.days!==0)
          throw new RangeError("Instant arithmetic does not accept calendar units.");
        const seconds=(BigInt(duration.hours)*60n+BigInt(duration.minutes))*60n+BigInt(duration.seconds);
        const nanoseconds=((seconds*1000n+BigInt(duration.milliseconds))*1000n+BigInt(duration.microseconds))*1000n+BigInt(duration.nanoseconds);
        const result=createSandboxTemporalInstant(epoch+(name==="add"?nanoseconds:-nanoseconds));
        setSandboxPrototype(result,prototype,budget);
        createDataCheckpoint(budget,context)(result,0,true);
        return result;
      }});
    Object.defineProperty(prototype,name,{value:method,writable:true,configurable:true});
    arithmetic.push(method);
  }
  for (const name of ["fromEpochMilliseconds","fromEpochNanoseconds","from"] as const) {
    const factory=createSandboxClosure({guest:true,sandbox:true,name,length:1,
      call:async ([input],context)=>{
        const epoch=name==="from"?await toInstantEpoch(input,context)
          :name==="fromEpochNanoseconds"?await sandboxBigInt(input,budget,context)
          :BigInt(await sandboxNumber(input,budget,context))*1000000n;
        const result=createSandboxTemporalInstant(epoch);
        setSandboxPrototype(result,prototype,budget);
        createDataCheckpoint(budget,context)(result,0,true);
        return result;
      }});
    Object.defineProperty(materializeFunctionProperties(constructor),name,{value:factory,writable:true,configurable:true});
    factories.push(factory);
  }
  const compare=createSandboxClosure({guest:true,sandbox:true,name:"compare",length:2,
    call:async ([first,second],context)=>{
      let firstEpoch: SandboxValue;
      const release=retainValues(budget,()=>[first,second,firstEpoch]);
      try {
        firstEpoch=await toInstantEpoch(first,context);
        const secondEpoch=await toInstantEpoch(second,context);
        return firstEpoch<secondEpoch?-1:firstEpoch>secondEpoch?1:0;
      } finally {release();}
    }});
  Object.defineProperty(materializeFunctionProperties(constructor),"compare",{value:compare,writable:true,configurable:true});
  const equals=createSandboxClosure({guest:true,sandbox:true,name:"equals",length:1,
    call:async ([other],context)=>{
      const epoch=temporalInstantEpoch(context?.thisValue);
      return epoch===await toInstantEpoch(other,context);
    }});
  const round=createSandboxClosure({guest:true,sandbox:true,name:"round",length:1,
    call:async ([options],context)=>{
      const epoch=temporalInstantEpoch(context?.thisValue);
      const result=createSandboxTemporalInstant(await roundTemporalInstant(epoch,options,budget,context));
      setSandboxPrototype(result,prototype,budget);
      createDataCheckpoint(budget,context)(result,0,true);
      return result;
    }});
  const valueOf=createSandboxClosure({guest:true,sandbox:true,name:"valueOf",length:0,
    call:()=>{throw new TypeError("Temporal Instant cannot be converted to a primitive value.");}});
  const toString=createSandboxClosure({guest:true,sandbox:true,name:"toString",length:0,
    call:([options],context)=>formatTemporalInstant(temporalInstantEpoch(context?.thisValue),options,budget,context)});
  const toJSON=createSandboxClosure({guest:true,sandbox:true,name:"toJSON",length:0,
    call:(_args,context)=>formatTemporalInstant(temporalInstantEpoch(context?.thisValue),undefined,budget,context)});
  const toLocaleString=createSandboxClosure({guest:true,sandbox:true,name:"toLocaleString",length:0,
    call:(args,context)=>{
      const epoch=temporalInstantEpoch(context?.thisValue);
      const quotient=epoch/1000000n;
      const milliseconds=Number(epoch<0n && epoch%1000000n!==0n?quotient-1n:quotient);
      return formatDateLocale("toLocaleString",milliseconds,args,budget,context);
    }});
  const toZonedDateTimeISO=createSandboxClosure({guest:true,sandbox:true,name:"toZonedDateTimeISO",length:1,
    call:([input],context)=>{
      const epoch=temporalInstantEpoch(context?.thisValue);
      let timeZone: string | undefined;
      let result: SandboxValue;
      const release=retainValues(budget,()=>[epoch,input,timeZone,result]);
      try {
        if (isSandboxTemporalZonedDateTime(input)) timeZone=temporalZonedDateTimeFields(input).timeZone;
        else {
          if (typeof input!=="string") throw new TypeError("Time zone must be a string or ZonedDateTime.");
          budget.visitNode(input.length);
          timeZone=budget.allocateString(parseTemporalTimeZoneString(input));
        }
        result=createSandboxTemporalZonedDateTime({epochNanoseconds:epoch,timeZone,calendar:"iso8601"});
        setSandboxPrototype(result,zonedDateTimePrototype,budget);
        createDataCheckpoint(budget,context)(result,0,true);
        return result;
      } finally {release();}
    }});
  Object.defineProperties(prototype,{
    toZonedDateTimeISO:{value:toZonedDateTimeISO,writable:true,configurable:true},
    equals:{value:equals,writable:true,configurable:true},
    round:{value:round,writable:true,configurable:true},
    valueOf:{value:valueOf,writable:true,configurable:true},
    toString:{value:toString,writable:true,configurable:true},
    toJSON:{value:toJSON,writable:true,configurable:true},
    toLocaleString:{value:toLocaleString,writable:true,configurable:true}
  });
  for (const name of ["epochNanoseconds","epochMilliseconds"] as const) {
    const getter=createSandboxClosure({guest:true,sandbox:true,name:`get ${name}`,length:0,
      call:(_args,context)=>{
        const epoch=temporalInstantEpoch(context?.thisValue);
        if (name==="epochNanoseconds") return epoch;
        const quotient=epoch/1000000n;
        return Number(epoch<0n && epoch%1000000n!==0n?quotient-1n:quotient);
      }});
    Object.defineProperty(prototype,name,{get:accessorAdapter(getter,"get"),configurable:true});
    getters.push(getter);
  }
  Object.defineProperties(namespace,{
    Now:{value:createTemporalNowNamespace(budget,clock,defaultTimeZone,{
      Instant:prototype,ZonedDateTime:zonedDateTimePrototype,PlainDateTime:plainDateTimePrototype,
      PlainDate:plainDatePrototype,PlainTime:plainTimePrototype
    }),writable:true,configurable:true},
    PlainMonthDay:{value:createTemporalPlainMonthDayConstructor(budget,plainDatePrototype,plainMonthDayPrototype),writable:true,configurable:true},
    PlainYearMonth:{value:createTemporalPlainYearMonthConstructor(budget,plainYearMonthPrototype,plainDatePrototype,durationPrototype),writable:true,configurable:true},
    Duration:{value:durationConstructor,writable:true,configurable:true},
    PlainTime:{value:plainTimeConstructor,writable:true,configurable:true},
    PlainDateTime:{value:createTemporalPlainDateTimeConstructor(budget,plainTimePrototype,durationPrototype,plainDatePrototype,plainDateTimePrototype,zonedDateTimePrototype),writable:true,configurable:true},
    PlainDate:{value:plainDateConstructor,writable:true,configurable:true},
    ZonedDateTime:{value:createTemporalZonedDateTimeConstructor(budget,prototype,plainDatePrototype,plainTimePrototype,plainDateTimePrototype,durationPrototype,zonedDateTimePrototype),writable:true,configurable:true},
    Instant:{value:constructor,writable:true,configurable:true},
    [Symbol.toStringTag]:{value:"Temporal",configurable:true}
  });
  setSandboxPrototype(prototype,getSandboxPrototype(Object.create(null),budget));
  setSandboxPrototype(namespace,getSandboxPrototype(Object.create(null),budget));
  registerRealmPrototype(budget,"Temporal.Instant",prototype);
  registerBuiltinIdentities(budget,{Temporal:namespace});
  for (const fn of [constructor,...getters,...factories,...arithmetic,compare,equals,round,valueOf,toString,toJSON,toLocaleString,toZonedDateTimeISO]) registerIntrinsicFunction(budget,fn);
  registerIntrinsicObject(budget,prototype);
  registerIntrinsicObject(budget,namespace);
  return namespace;

  async function toInstantEpoch(input: SandboxValue,context?: SandboxCallContext): Promise<bigint> {
    if (isSandboxTemporalInstant(input)) return temporalInstantEpoch(input);
    if (isSandboxTemporalZonedDateTime(input)) return temporalZonedDateTimeFields(input).epochNanoseconds;
    const primitive=input!==null && typeof input==="object"
      ?await objectToPrimitive(input,budget,context,new Set(),"string"):input;
    if (typeof primitive!=="string") throw new TypeError("Instant input must be a string or Temporal value.");
    budget.allocateString(primitive);
    budget.visitNode(primitive.length);
    validateTemporalStringOffsets(primitive);
    return TemporalBackend.Instant.from(primitive).epochNanoseconds;
  }
}
