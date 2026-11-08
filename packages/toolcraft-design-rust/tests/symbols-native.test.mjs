import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { symbols } from "../../toolcraft-design/dist/components/symbols.js";
import * as tokens from "../../toolcraft-design/dist/tokens/index.js";
import { withOutputFormat } from "../../toolcraft-design/dist/internal/output-format.js";
import { configureTheme, resetTheme } from "../../toolcraft-design/dist/internal/theme-state.js";
import { getTheme } from "../../toolcraft-design/dist/internal/theme-detect.js";

test("native symbols preserve live output scopes, brands, colors and descriptors", async () => {
  assert.equal(typeof native.symbols,"object");
  const component=await import("toolcraft-design-rust/components/symbols");
  assert.equal(component.symbols,native.symbols);
  assert.deepEqual(Object.keys(native.symbols),Object.keys(symbols));
  const force=process.env.FORCE_COLOR,mode=process.env.POE_CODE_THEME;
  try {
    for(const color of ["0","1"]) for(const theme of ["light","dark"]) for(const brand of ["purple","blue","green"]) {
      process.env.FORCE_COLOR=color;process.env.POE_CODE_THEME=theme;
      configureTheme({brand});native.configureTheme({brand});
      for(const format of ["terminal","markdown","json"]) {
        assert.deepEqual(native.withOutputFormat(format,()=>({...native.symbols})),withOutputFormat(format,()=>({...symbols})));
      }
    }
    for(const key of Object.keys(symbols)) {
      const actual=Object.getOwnPropertyDescriptor(native.symbols,key),expected=Object.getOwnPropertyDescriptor(symbols,key);
      for(const field of ["enumerable","configurable","writable","set","value"]) assert.equal(actual[field],expected[field],`${key}.${field}`);
      assert.equal(actual.get?.name,expected.get?.name,key);
    }
    const nested=async (api,scope)=>scope("markdown",async()=>{
      const before=api.resolved;
      const inner=await scope("json",async()=>{await Promise.resolve();return api.resolved;});
      return [before,inner,api.resolved];
    });
    assert.deepEqual(await nested(native.symbols,native.withOutputFormat),await nested(symbols,withOutputFormat));
  } finally {
    resetTheme();native.resetTheme();
    if(force===undefined)delete process.env.FORCE_COLOR;else process.env.FORCE_COLOR=force;
    if(mode===undefined)delete process.env.POE_CODE_THEME;else process.env.POE_CODE_THEME=mode;
  }
});

test("symbol theme properties remain lazy and preserve thrown values", () => {
  const marker={marker:true};
  for(const [api,scope,theme] of [[native.symbols,native.withOutputFormat,native.getTheme()],[symbols,withOutputFormat,getTheme()]]) {
    for(const [key,property] of [["resolved","resolvedSymbol"],["errorResolved","errorSymbol"]]) {
      const descriptor=Object.getOwnPropertyDescriptor(theme,property);
      try {
        Object.defineProperty(theme,property,{configurable:true,get(){assert.equal(this,theme);throw marker;}});
        assert.throws(()=>scope("terminal",()=>api[key]),error=>error===marker);
        assert.equal(typeof scope("markdown",()=>api[key]),"string");
        assert.equal(typeof scope("json",()=>api[key]),"string");
      } finally {Object.defineProperty(theme,property,descriptor);}
    }
  }
});

test("token namespace and subpaths share standalone mutable token objects", async () => {
  assert.equal(typeof native.tokens,"object");
  const own=await import("toolcraft-design-rust/tokens/index");
  assert.deepEqual(Object.keys(own),Object.keys(tokens));
  for(const name of Object.keys(own)) assert.equal(own[name],native.tokens[name]);
  for(const name of ["widths","spacing","typography","brands","brand","dark","light"]) assert.equal(own[name],native[name]);
  for(const name of ["widths","spacing"]) {
    const sub=await import(`toolcraft-design-rust/tokens/${name}`);
    assert.equal(sub[name],own[name]);
    assert.deepEqual(Object.getOwnPropertyDescriptors(own[name]),Object.getOwnPropertyDescriptors(tokens[name]));
    const key=Object.keys(own[name])[0],before=own[name][key];
    try {own[name][key]=123;assert.equal(native[name][key],123);}finally{own[name][key]=before;}
  }
  const colors=await import("toolcraft-design-rust/tokens/colors");
  assert.deepEqual(Object.keys(colors),["brand","createPalette","dark","light"]);
  assert.equal(colors.createPalette,own.createPalette);
  assert.equal((await import("toolcraft-design-rust/tokens/brand")).brands,own.brands);
  assert.equal((await import("toolcraft-design-rust/tokens/typography")).typography,own.typography);
});
