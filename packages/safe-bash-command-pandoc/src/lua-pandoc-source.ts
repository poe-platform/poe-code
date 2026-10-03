import {luaAst} from "./lua-ast.js";

/** Freeze trusted entrypoints before filter source can mutate globals. */
export const luaPandocSource=luaAst+`
local runner, globals = __pandoc_run, _G
local unsupported, invalid = __pandoc_unsupported, __pandoc_invalid
local type, next, rawlen, rawget = type, next, rawlen, rawget
-- The public protocol uses tagged enum objects; the established Lua API uses
-- strings. Both traversals execute on retained Lua frames and tables.
local enums = {
  AlignLeft=true, AlignRight=true, AlignCenter=true, AlignDefault=true,
  SingleQuote=true, DoubleQuote=true, InlineMath=true, DisplayMath=true,
  AuthorInText=true, SuppressAuthor=true, NormalCitation=true,
  DefaultStyle=true, Example=true, Decimal=true, LowerRoman=true,
  UpperRoman=true, LowerAlpha=true, UpperAlpha=true,
  DefaultDelim=true, Period=true, OneParen=true, TwoParens=true
}
local function from_wire(value, depth)
  check_depth(depth)
  if type(value) ~= 'table' then return value end
  if enums[value.t] then return value.t end
  for key,child in next,value do value[key]=from_wire(child,depth+1) end
  return value
end
local function enum(value)
  if type(value)=='string' then return {t=value} end
  return value
end
local function rows(value)
  for _,row in ipairs(value) do
    for _,cell in ipairs(row[2]) do cell[2]=enum(cell[2]) end
  end
end
local function to_wire(value, depth)
  check_depth(depth)
  if type(value) ~= 'table' then return value end
  for key,child in next,value do value[key]=to_wire(child,depth+1) end
  local tag,c=value.t,value.c
  if tag=='Quoted' or tag=='Math' then c[1]=enum(c[1])
  elseif tag=='OrderedList' then c[1][2]=enum(c[1][2]); c[1][3]=enum(c[1][3])
  elseif tag=='Cite' then
    for _,citation in ipairs(c[1]) do citation.citationMode=enum(citation.citationMode) end
  elseif tag=='Table' then
    for _,spec in ipairs(c[3]) do spec[1]=enum(spec[1]) end
    rows(c[4][2]); rows(c[6][2])
    for _,body in ipairs(c[5]) do rows(body[3]); rows(body[4]) end
  end
  return value
end
local callbacks={}
for name in next,__pandoc_callbacks do callbacks[name]=true end
return function(result)
  local filters={}
  local function capture(value,global)
    if type(value) ~= 'table' then unsupported('Expected a Lua filter table') end
    local frozen={}
    for name,fn in next,value do
      if type(name) ~= 'string' then unsupported('Invalid Lua filter callback name') end
      if not callbacks[name] then
        if not global then unsupported('Unsupported Lua filter field: '..name) end
      else
        if type(fn) ~= 'function' then invalid('Lua '..name..' callback must be a function') end
        frozen[name]=fn
      end
    end
    filters[#filters+1]=frozen
  end
  if result == nil then capture(globals._G,true)
  elseif type(result) == 'table' and rawlen(result) > 0 then
    for i=1,rawlen(result) do capture(rawget(result,i),false) end
  else capture(result,false) end
  return function(document)
    local result=to_wire(runner(from_wire({blocks=document.blocks,meta=document.meta},0),filters),0)
    result['pandoc-api-version']=document['pandoc-api-version']
    return result
  end
end
`;
