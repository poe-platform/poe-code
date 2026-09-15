import {codecStreamInventoryCases} from './codec-stream-inventory-cases.js';

/** Exercise every owned callable in the pinned class inventory without
 * constructing a fake stream or bypassing guest argument binding. */
export const codecStreamBindingCases=codecStreamInventoryCases.map(({name})=>{
  const separator=name.lastIndexOf('.');
  return {name,source:`
module = __import__('${name.slice(0,separator)}', fromlist=['*'])
cls = getattr(module, '${name.slice(separator+1)}')
for name, member in cls.__dict__.items():
    if type(member).__name__ not in ('function', 'builtin_function_or_method'):
        continue
    print(name)
    for args, kwargs in (((), {}), ((None,) * 20, {}), ((), {'unexpected': None})):
        try:
            member(*args, **kwargs)
        except TypeError as error:
            print(error.args)
        else:
            raise AssertionError('invalid call accepted')
    if type(member).__name__ == 'builtin_function_or_method':
        print(hasattr(member, '__get__'), getattr(cls, name) is member)
        continue
    for args in ((), (None,), (None, None), (1, 2, 3)):
        try:
            member.__get__(*args)
        except TypeError as error:
            print(error.args)
        else:
            raise AssertionError('invalid descriptor call accepted')
    print(member.__get__(None, 42) is member)
    receiver = object()
    bound = member.__get__(receiver, cls)
    print(bound.__self__ is receiver, bound.__func__ is member, member.__get__(None, cls) is member)
`};
});
