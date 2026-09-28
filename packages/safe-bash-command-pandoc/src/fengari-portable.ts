// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./fengari.d.ts" />
import lua from "fengari/src/lua.js";
import lauxlib from "fengari/src/lauxlib.js";
import base from "fengari/src/lbaselib.js";
import string from "fengari/src/lstrlib.js";
import table from "fengari/src/ltablib.js";
import math from "fengari/src/lmathlib.js";
import utf8 from "fengari/src/lutf8lib.js";
import {to_luastring, to_jsstring} from "fengari/src/fengaricore.js";

// Filters admit only these libraries; importing lualib also installs host loading.
export const lualib = {...base, ...string, ...table, ...math, ...utf8};

export {lua, lauxlib, to_luastring, to_jsstring};
