import {expect, it} from "vitest";
import {createRealm} from "./realm.js";

it("runs a public source module through an explicit resolver", async () => {
  const realm = createRealm({sourceResolver:(specifier: string) => specifier === "dep"
    ? {id:"dep",source:"export let x=1; export function inc(){x++}"} : undefined});
  try {
    expect(await realm.evaluate("import {x,inc} from 'dep'; inc(); export const result=x;",{filename:"entry",sourceType:"module"}))
      .toMatchObject({ok:true,returnValue:{result:2}});
  } finally {await realm.close();}
});

it("denies ungranted imports while permitting a standalone module", async () => {
  const realm = createRealm();
  try {
    expect(await realm.evaluate("export const x=1",{filename:"standalone",sourceType:"module"}))
      .toMatchObject({ok:true,returnValue:{x:1}});
    await expect(realm.evaluate("import 'node:fs'",{filename:"denied",sourceType:"module"}))
      .rejects.toThrow("Source resolver denied");
  } finally {await realm.close();}
});

it("keeps source globals and module instances owned by their realm", async () => {
  const sourceResolver = () => ({id:"counter",source:"export let x=0; export function inc(){return ++x}"});
  const first = createRealm({sourceResolver});
  const second = createRealm({sourceResolver});
  const source="import {inc} from 'counter'; export const result=inc(); export const top=this";
  try {
    expect(await first.evaluate(source,{filename:"one",sourceType:"module"})).toMatchObject({ok:true,returnValue:{result:1,top:undefined}});
    expect(await first.evaluate(source,{filename:"two",sourceType:"module"})).toMatchObject({ok:true,returnValue:{result:2}});
    expect(await second.evaluate(source,{filename:"one",sourceType:"module"})).toMatchObject({ok:true,returnValue:{result:1}});
  } finally {await first.close();await second.close();}
});

it("charges retained source text against the realm data budget", async () => {
  const {Budget} = await import("./interp/budget.js");
  const realm = createRealm({budget:new Budget({dataSize:5000}),sourceResolver:() => ({id:"dep",source:`/*${"x".repeat(10000)}*/export const value=1`})});
  try {
    await expect(realm.evaluate("import 'dep'",{sourceType:"module"})).rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
  } finally {await realm.close();}
});

it("cancels a pending source resolution", async () => {
  let ready!: () => void;
  const started = new Promise<void>(resolve => {ready=resolve;});
  const controller = new AbortController();
  const realm = createRealm({signal:controller.signal,sourceResolver:() => {ready();return new Promise(() => {});}});
  const execution = realm.evaluate("import 'pending'",{sourceType:"module"});
  void execution.catch(() => {});
  await started;
  controller.abort(new Error("stop source loading"));
  await expect(execution).rejects.toThrow("stop source loading");
  await realm.close();
});

it("shares canonical source identities across distinct granted specifiers",async()=>{
  const realm=createRealm({sourceResolver:()=>({id:"canonical",source:"export const token={}"})});
  try {
    expect(await realm.evaluate("import * as a from 'alias-a';import * as b from 'alias-b';export const same=a===b&&a.token===b.token",{filename:"entry",sourceType:"module"}))
      .toMatchObject({ok:true,returnValue:{same:true}});
  } finally {await realm.close();}
});
it("rejects conflicting source text under one canonical identity",async()=>{
  const realm=createRealm({sourceResolver:specifier=>({id:"canonical",source:specifier==="a"?"export const x=1":"export const x=2"})});
  try {
    await expect(realm.evaluate("import 'a';import 'b'",{filename:"entry",sourceType:"module"}))
      .rejects.toThrow("changed within the graph");
  } finally {await realm.close();}
});
it("cancels a module awaiting a pending registered host operation",async()=>{
  let ready!:()=>void;
  const started=new Promise<void>(resolve=>{ready=resolve;});
  const controller=new AbortController();
  const realm=createRealm({signal:controller.signal,modules:{cap:{wait:()=>{ready();return new Promise(()=>{});}}}});
  const execution=realm.evaluate("import {wait} from 'cap';await wait();export const survived=true",{sourceType:"module"});
  void execution.catch(()=>{});
  await started;
  controller.abort(new Error("stop host wait"));
  await expect(execution).rejects.toThrow("stop host wait");
  await realm.close();
});
