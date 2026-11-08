import {expect,it} from "vitest";
import {compileLuaLibrary} from "./lua-library.mjs";
import {luaTableSource} from "../src/lua-table-source.js";
import {tableLibrary} from "../src/lua-table.generated.js";

it("ships table bytecode matching the maintained library source",()=>{
  expect(tableLibrary).toEqual(compileLuaLibrary(luaTableSource));
});

import {luaStringSource} from "../src/lua-string-source.js";
import {stringLibrary} from "../src/lua-string.generated.js";
it("ships string bytecode matching the maintained library source",()=>{
  expect(stringLibrary).toEqual(compileLuaLibrary(luaStringSource));
});

import {luaPandocSource} from "../src/lua-pandoc-source.js";
import {pandocLibrary} from "../src/lua-pandoc.generated.js";
it("ships Pandoc bytecode matching the maintained library source",()=>{
  expect(pandocLibrary).toEqual(compileLuaLibrary(luaPandocSource));
});
