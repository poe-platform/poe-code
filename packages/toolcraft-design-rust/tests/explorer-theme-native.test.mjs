import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/theme.js';
import * as originalState from '../../toolcraft-design/dist/internal/theme-state.js';
import {getTheme as originalTheme} from '../../toolcraft-design/dist/internal/theme-detect.js';
import * as nativeState from '../dist/theme-state.js';
import {getTheme as nativeTheme} from '../dist/theme.js';

test('explorer themes preserve brands, modes, style identities and formatter output',async()=>{
  const native=await import('toolcraft-design-rust/explorer/theme');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  const saved=process.env.POE_CODE_THEME;
  try{
    for(const mode of ['dark','light'])for(const brand of ['purple','blue','green']){
      process.env.POE_CODE_THEME=mode;originalState.configureTheme({brand});nativeState.configureTheme({brand});
      assert.deepEqual(native.getExplorerStyles(),reference.getExplorerStyles());
      const n=native.getExplorerTheme(),r=reference.getExplorerTheme();
      assert.deepEqual(Object.keys(n),Object.keys(r));
      for(const [name,fn]of Object.entries(n))assert.equal(fn.length,r[name].length);
      for(const text of ['','Text','\u001b[31mstyled\u001b[0m','é😀\ud800']){
        for(const name of ['accent','muted','border','borderFocused','matchHighlight'])assert.equal(n[name](text),r[name](text));
        for(const tone of ['success','warning','error','info','muted'])assert.equal(n.badge(text,tone),r.badge(text,tone));
      }
      for(const [api,getTheme]of [[native,nativeTheme],[reference,originalTheme]]){
        const palette=getTheme(),styles=api.getExplorerStyles(),theme=api.getExplorerTheme();
        assert.equal(styles.accent,palette.styles.accent);assert.equal(styles.border,styles.muted);assert.equal(styles.borderFocused,styles.accent);assert.equal(styles.tones.info,palette.styles.info);
        assert.notEqual(styles.matchHighlight,styles.accent);assert.notEqual(styles.matchHighlight,api.getExplorerStyles().matchHighlight);
        assert.equal(theme.accent,palette.accent);assert.equal(theme.border,theme.muted);assert.equal(theme.borderFocused,theme.accent);
      }
    }
  }finally{originalState.resetTheme();nativeState.resetTheme();if(saved===undefined)delete process.env.POE_CODE_THEME;else process.env.POE_CODE_THEME=saved;}
});

test('explorer theme callbacks keep live receivers, coercion order and thrown values',async()=>{
  const native=await import('toolcraft-design-rust/explorer/theme');
  function capture(api,getTheme){
    const trace=[],palette=getTheme(),original=Object.getOwnPropertyDescriptor(palette,'accent');
    try{
      const theme=api.getExplorerTheme();
      Object.defineProperty(palette,'accent',{configurable:true,get(){trace.push('accent');return function(text){trace.push(['invoke',this===palette,text]);return text;};}});
      const text={[Symbol.toPrimitive](hint){trace.push(['text',hint]);return 'value';}};
      const tone={[Symbol.toPrimitive](hint){trace.push(['tone',hint]);return 'accent';}};
      return {badge:theme.badge(text,tone),match:theme.matchHighlight(text),trace};
    }finally{Object.defineProperty(palette,'accent',original);}
  }
  assert.deepEqual(capture(native,nativeTheme),capture(reference,originalTheme));
  for(const tone of [undefined,null,'missing',Symbol('tone')]){
    const capture=api=>{try{return api.getExplorerTheme().badge('value',tone);}catch(error){return [error.name,error.message];}};
    assert.deepEqual(capture(native),capture(reference));
  }
  const failure=Symbol('coercion');
  assert.throws(()=>native.getExplorerTheme().matchHighlight({toString(){throw failure;}}),error=>error===failure);
  assert.throws(()=>native.getExplorerTheme().badge({toString(){throw failure;}},'info'),error=>error===failure);
});

test('explorer style assembly preserves getter order, snapshots and reentrancy',async()=>{
  const native=await import('toolcraft-design-rust/explorer/theme');
  function capture(api,getTheme){
    const styles=getTheme().styles,descriptors=Object.getOwnPropertyDescriptors(styles),trace=[];
    try{
      for(const [key,descriptor]of Object.entries(descriptors))Object.defineProperty(styles,key,{configurable:true,enumerable:descriptor.enumerable,get(){trace.push(key);return descriptor.value;}});
      return {value:api.getExplorerStyles(),trace};
    }finally{Object.defineProperties(styles,descriptors);}
  }
  assert.deepEqual(capture(native,nativeTheme),capture(reference,originalTheme));
  const styles=nativeTheme().styles,original=Object.getOwnPropertyDescriptor(styles,'muted');
  try{
    let active=false;
    Object.defineProperty(styles,'muted',{configurable:true,get(){if(!active){active=true;native.getExplorerStyles();active=false;}return original.value;}});
    assert.equal(native.getExplorerStyles().muted,original.value);
  }finally{Object.defineProperty(styles,'muted',original);}
});

test('explorer projections create own properties without invoking inherited setters',async()=>{
  const native=await import('toolcraft-design-rust/explorer/theme');
  nativeTheme();originalTheme();
  function capture(api){
    const trace=[],saved=Object.getOwnPropertyDescriptor(Object.prototype,'border');
    try{
      Object.defineProperty(Object.prototype,'border',{configurable:true,set(){trace.push('border');}});
      const theme=api.getExplorerTheme(),styles=api.getExplorerStyles();
      return {trace,themeOwn:Object.hasOwn(theme,'border'),stylesOwn:Object.hasOwn(styles,'border'),themeAlias:theme.border===theme.muted,stylesAlias:styles.border===styles.muted};
    }finally{if(saved)Object.defineProperty(Object.prototype,'border',saved);else delete Object.prototype.border;}
  }
  assert.deepEqual(capture(native),capture(reference));
});
