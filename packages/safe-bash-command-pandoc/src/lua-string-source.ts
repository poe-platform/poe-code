/** Iterator captures and progress live in retained Lua cells. */
export const luaStringSource = `
local library, str, nextMatch, int, finish, token, formatToken, formatValue = ...
local type, error, tostring, select = type, error, tostring, select
local sub, byte = library.sub, library.byte
function library.gmatch(subject, pattern)
  subject=str(subject); pattern=str(pattern)
  local position,last=0,-1
  local function emit(first,finish,...)
    if first == nil then return end
    position=finish; last=finish
    return ...
  end
  return function()
    return emit(nextMatch(subject,pattern,position,last))
  end
end
function library.gsub(subject,pattern,replacement,maximum)
  subject=str(subject); pattern=str(pattern)
  local kind=type(replacement)
  if kind ~= 'string' and kind ~= 'number' and kind ~= 'function' and kind ~= 'table' then error('Invalid replacement value') end
  if kind == 'number' then replacement=str(replacement); kind='string' end
  if maximum == nil then maximum=#subject+1.0 else maximum=int(maximum) end
  local pieces,used,count,position,last={},0,0,0,-1
  local anchor=byte(pattern)==94
  local function append(value)
    used=used+1.0; pieces[used]=value
  end
  local function apply(first,ending,...)
    if first == nil then return false end
    append(sub(subject,position+1,first-1))
    local whole=sub(subject,first,ending)
    if kind == 'string' then
      local captures,n={...},select('#',...)
      local at=0
      while at < #replacement do
        local value,capture
        at,value,capture=token(replacement,at)
        if capture then
          if value == 0 then value=whole
          elseif value > n then error('Invalid capture index')
          else value=tostring(captures[value]) end
        end
        append(value)
      end
    else
      local value
      if kind == 'function' then value=replacement(...)
      else value=replacement[(...)] end
      if value == nil or value == false then value=whole else value=str(value) end
      append(value)
    end
    position=ending;last=ending;count=count+1
    return true
  end
  while count < maximum do
    if not apply(nextMatch(subject,pattern,position,last,true)) then break end
    if anchor then break end
  end
  append(sub(subject,position+1))
  return finish(pieces,used),count
end
function library.format(format,...)
  format=str(format)
  local values,n={...},select('#',...)
  local pieces,count,position,argument={},0,0,0
  while position < #format do
    local value,kind
    position,value,kind=formatToken(format,position)
    if kind ~= nil then
      argument=argument+1
      if argument > n then error('No value for format') end
      local input=values[argument]
      if kind == 115 then input=tostring(input) end
      value=formatValue(value,input)
    end
    count=count+1.0;pieces[count]=value
  end
  return finish(pieces,count)
end
`;
