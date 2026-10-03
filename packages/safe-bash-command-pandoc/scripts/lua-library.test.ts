import {expect,it} from "vitest";
import {compileLuaLibrary} from "./lua-library.mjs";
import {luaTableSource} from "../src/lua-table-source.js";
import {tableLibrary} from "../src/lua-table.generated.js";

it("ships table bytecode matching the maintained library source",()=>{
  expect(tableLibrary).toEqual(compileLuaLibrary(luaTableSource));
});
