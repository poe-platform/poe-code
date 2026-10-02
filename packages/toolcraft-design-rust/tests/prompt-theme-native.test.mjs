import assert from "node:assert/strict";
import {test} from "node:test";
import {promptTheme as reference} from "../../toolcraft-design/dist/prompts/theme.js";
import {brands as originalBrands} from "../../toolcraft-design/dist/tokens/brand.js";
import {configureTheme as originalConfigure,resetTheme as originalReset} from "../../toolcraft-design/dist/internal/theme-state.js";
import {configureTheme,resetTheme} from "../dist/logging.js";
import {brands} from "../dist/tokens-brand.js";

test("promptTheme shares mutable symbols and a live accent getter across exports",async()=>{
  const {promptTheme}=await import("../dist/index.js");assert.ok(promptTheme);
  assert.equal(promptTheme,(await import("toolcraft-design-rust/prompts/theme")).promptTheme);
  assert.deepEqual(promptTheme.symbols,reference.symbols);
  assert.deepEqual(Object.keys(promptTheme),Object.keys(reference));
  for(const name of Object.keys(reference.symbols))assert.deepEqual(Object.getOwnPropertyDescriptor(promptTheme.symbols,name),Object.getOwnPropertyDescriptor(reference.symbols,name));
  const expected=Object.getOwnPropertyDescriptor(reference.style,"accentColor"),actual=Object.getOwnPropertyDescriptor(promptTheme.style,"accentColor");
  for(const key of ["enumerable","configurable","set"])assert.equal(actual[key],expected[key]);
  assert.equal(actual.get.name,expected.get.name);assert.equal(actual.get.length,expected.get.length);
  try{
    for(const brand of Object.keys(originalBrands)){
      configureTheme({brand});originalConfigure({brand});assert.equal(promptTheme.style.accentColor,reference.style.accentColor);
    }
    configureTheme({brand:"blue"});originalConfigure({brand:"blue"});
    const a=brands.blue.primary,b=originalBrands.blue.primary;
    try{brands.blue.primary="#123456";originalBrands.blue.primary="#123456";assert.equal(promptTheme.style.accentColor,reference.style.accentColor);assert.equal(promptTheme.style.accentColor,"#123456");}
    finally{brands.blue.primary=a;originalBrands.blue.primary=b;}
  }finally{resetTheme();originalReset();}
  assert.equal(promptTheme.style.accentColor,reference.style.accentColor);
});
