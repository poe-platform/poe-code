import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const source=String.raw`
assert 'bücher'.encode('punycode') == b'bcher-kva'
assert '例え'.encode('PUNYCODE') == b'r8jz45g'
assert '\ud800'.encode('punycode', 'unknown') == b'ib9b'
assert b'BCHER-KVA'.decode('punycode') == 'BüCHER'
assert str(b'bcher-kva', 'punycode') == 'bücher'
assert b'abc-z'.decode('punycode', 'replace') == 'abc'
assert b'abc-z'.decode('punycode', 'ignore') == 'abc'
for method in (lambda data, errors: data.decode('punycode', errors), lambda data, errors: str(data, 'punycode', errors)):
    try:
        method(b'z', 'strict')
    except UnicodeDecodeError as error:
        assert error.encoding == 'punycode'
        assert error.object == b'z'
        assert (error.start, error.end, error.reason) == (1, 2, 'incomplete punycode string')
    else:
        assert False
    try:
        method(b'999999999999999a', 'strict')
    except UnicodeDecodeError as error:
        assert (error.start, error.end) == (47638888888885384, 47638888888885385)
        assert error.reason == 'Invalid character U+a93f5129b76109'
        assert error.args[2:4] == (47638888888885384, 47638888888885385)
    else:
        assert False
    for policy in ('unknown', 'surrogateescape', 'backslashreplace'):
        try:
            method(b'abc-', policy)
        except UnicodeError as error:
            assert error.args == ('Unsupported error handling: ' + policy,)
        else:
            assert False
`;

it("uses Punycode through real guest text consumers and exception storage",()=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source).status).toBe("ok");
});
