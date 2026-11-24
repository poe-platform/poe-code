use lua_rust::{Runtime, Value};

#[test]
fn sparse_lengths_follow_the_reference_boundary_search() {
    for (source, expected) in [
        (
            "local t={1,2,nil,4}; return #t,rawlen(t),table.remove(t)",
            vec![4, 4, 4],
        ),
        (
            "local t={};t[1]=1;t[2]=2;t[4]=4;return #t,rawlen(t)",
            vec![4, 4],
        ),
        (
            "local t={};for i=1,8 do t[i]=i end;t[3]=nil;t[6]=nil;return #t,rawlen(t)",
            vec![8, 8],
        ),
        (
            "local t={1,2,3,4};t[3]=nil;table.insert(t,5);return #t,t[4],t[5]",
            vec![5, 4, 5],
        ),
    ] {
        assert_eq!(
            Runtime::new(100_000).run(source, "lengths.lua").unwrap(),
            expected.into_iter().map(Value::Integer).collect::<Vec<_>>()
        );
    }
}

#[test]
fn lengths_wrap_at_lua_integer_width_without_platform_truncation() {
    for (power, expected) in [(30, 1 << 30), (31, i32::MIN), (32, 0), (52, 0)] {
        let source =
            format!("local t={{}};for i=0,{power} do t[2.0^i]=true end;return #t,rawlen(t)");
        assert_eq!(
            Runtime::new(100_000).run(source, "lengths.lua").unwrap(),
            vec![Value::Integer(expected); 2]
        );
    }
    let source =
        "local t={};for i=0,52 do t[2.0^i]=true end;t[9007199254740991]=true;return #t,rawlen(t)";
    assert_eq!(
        Runtime::new(100_000).run(source, "lengths.lua").unwrap(),
        vec![Value::Integer(-1); 2]
    );
}

#[test]
fn raw_length_ignores_index_and_length_callbacks() {
    let source = "local calls=0;local t=setmetatable({1,2,nil,4},{__len=function() calls=calls+1;return 7 end,__index=function() error('unexpected indexing') end});return rawlen(t),#t,calls,rawlen('aΩ')";
    assert_eq!(
        Runtime::new(100_000).run(source, "lengths.lua").unwrap(),
        vec![
            Value::Integer(4),
            Value::Integer(7),
            Value::Integer(1),
            Value::Integer(3)
        ]
    );
}

#[test]
fn dense_false_values_and_empty_tables_keep_their_lengths() {
    for size in [0, 1, 2, 3, 4, 7, 8, 15, 16, 31, 32, 63, 64] {
        let source = format!(
            "local t={{[-1]=9,[0]=8,[1.5]=7,x=6}};for i=1,{size} do t[i]=false end;return #t,rawlen(t)"
        );
        assert_eq!(
            Runtime::new(100_000).run(source, "lengths.lua").unwrap(),
            vec![Value::Integer(size); 2]
        );
    }
}
