import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const source=String.raw`
for data, inner_object, start, end, reason in (
    (b'A\xff-z', b'A\xff', 1, 2, 'ordinal not in range(128)'),
    (b'abc-z', b'Z', 1, 2, 'incomplete punycode string'),
    (b'abc-?', b'?', 0, 1, "Invalid extended code point '63'"),
    (b'A-999999999a', b'999999999A', 47638885384, 47638885385, 'Invalid character U+58bbfda84'),
):
    for decode in (lambda: data.decode('punycode'), lambda: str(data, 'punycode')):
        outer = ValueError('outer')
        try:
            try:
                raise outer
            except ValueError:
                decode()
        except UnicodeDecodeError as error:
            assert error.__suppress_context__ is True, 'rewritten error suppression'
            assert error.__cause__ is None
            assert error.object == data
            inner = error.__context__
            assert type(inner) is UnicodeDecodeError
            assert inner is not error
            assert inner.args == (error.encoding, inner_object, start, end, reason)
            assert inner.__cause__ is None
            assert inner.__suppress_context__ is False
            if data == b'abc-z':
                indexing = inner.__context__
                assert type(indexing) is IndexError
                assert indexing.args == ('index out of range',)
                assert indexing.__context__ is outer
                assert indexing.__cause__ is None
                assert indexing.__suppress_context__ is False
            else:
                assert inner.__context__ is outer
        else:
            assert False, 'expected decoding failure'
for data in (b'A-hz767205604493046e', b'A-iz767205604493046e', b'A-jz767205604493046e'):
    outer = ValueError('outer overflow')
    try:
        try:
            raise outer
        except ValueError:
            data.decode('punycode')
    except OverflowError as error:
        assert error.args == ('Python int too large to convert to C ssize_t',)
        assert error.__cause__ is None
        assert error.__suppress_context__ is False
        if data == b'A-hz767205604493046e':
            inner = error.__context__
            assert type(inner) is UnicodeDecodeError, 'offset overflow context'
            assert inner.args == ('punycode', b'HZ767205604493046E', 9223372036854775806, 9223372036854775807, 'Invalid character U+400000000000007f')
            assert inner.__context__ is outer
        else:
            assert error.__context__ is outer
    else:
        assert False, 'expected position overflow'
`;

it("retains Punycode's rewritten exceptions and nested indexing failure through real text consumers",()=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  expect(result.status).toBe("ok");
});
