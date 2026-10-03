import {luaAst} from "./lua-ast.js";

/** Freeze trusted entrypoints before filter source can mutate globals. */
export const luaPandocSource=luaAst+`
local runner, globals = __pandoc_run, _G
local unsupported, invalid = __pandoc_unsupported, __pandoc_invalid
local type, next, rawlen, rawget = type, next, rawlen, rawget
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
    local result=runner({blocks=document.blocks,meta=document.meta},filters)
    result['pandoc-api-version']=document['pandoc-api-version']
    return result
  end
end
`;
