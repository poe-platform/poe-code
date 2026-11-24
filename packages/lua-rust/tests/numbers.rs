use lua_rust::{Runtime, Value};

fn text(source: &str) -> String {
    let values = Runtime::new(100_000).run(source, "numbers.lua").unwrap();
    assert_eq!(values.len(), 1);
    values[0].text()
}

#[test]
fn integer_and_float_arithmetic_keep_their_types() {
    assert_eq!(
        text(
            "local a,b=2147483647,2; return table.concat({a+1,a*b,math.type(1.0),7//2,7//2.0,'2'+1,7^2},',')"
        ),
        "-2147483648,-2,float,3,3.0,3.0,49.0"
    );
    assert_eq!(
        text("local a=-1; return table.concat({a>>1,a<<31,a>>32,1<<-2147483648},',')"),
        "2147483647,-2147483648,0,0"
    );
}

#[test]
fn numeric_tokens_and_strings_share_lua_parsing() {
    assert_eq!(
        text(
            "return table.concat({0xffffffff,0x1.8p2,tonumber('2147483648'),tonumber(' -0X.8p+2 '),math.type(tonumber('1.0')),tostring(tonumber('inf'))},',')"
        ),
        "-1,6.0,2147483648.0,-2.0,float,nil"
    );
}

#[test]
fn numeric_rendering_matches_fourteen_digit_javascript_rounding() {
    assert_eq!(
        text(
            "return table.concat({1.0,1e20,1e21,1e-6,1e-7,10000000000000.5,-10000000000000.5,-0.0},',')"
        ),
        "1.0,100000000000000000000.0,1e+21,0.000001,1e-7,10000000000001.0,-10000000000001.0,0.0"
    );
}

#[test]
fn equal_integer_float_keys_update_the_same_entry() {
    assert_eq!(
        text(
            "local t={[1]='a',[1.0]='b'}; local k=next(t); return t[1]..':'..math.type(k)..':'..tostring(rawequal(1,1.0))"
        ),
        "b:integer:true"
    );
}

#[test]
fn loops_preserve_integer_and_float_control_values() {
    assert_eq!(
        text(
            "local r={} for i=1,2 do r[#r+1]=i..':'..math.type(i) end for i=1.0,2 do r[#r+1]=i..':'..math.type(i) end for i=3,1.2,-1 do r[#r+1]=i end return table.concat(r,',')"
        ),
        "1:integer,2:integer,1.0:float,2.0:float,3,2"
    );
}

#[test]
fn integer_operations_reject_fractional_and_out_of_range_operands() {
    for source in [
        "return 1&1.5",
        "return 1<<2147483648.0",
        "local a=1; return a//0",
        "local a=1; return a%0",
    ] {
        assert!(
            Runtime::new(100_000).run(source, "numbers.lua").is_err(),
            "{source}"
        );
    }
    assert_eq!(
        Runtime::new(100_000)
            .run("return math.tointeger(2147483648.0)", "numbers.lua")
            .unwrap(),
        vec![Value::Nil]
    );
}

#[test]
fn radix_conversion_preserves_partial_digits_and_leading_zero_behavior() {
    assert_eq!(
        text(
            "return table.concat({tostring(tonumber('12z',10)),tostring(tonumber('102',2)),tostring(tonumber('000z',10)),tostring(tonumber('0x10',16)),tostring(tonumber('-00012z',10))},',')"
        ),
        "12,2,nil,nil,-12"
    );
}

#[test]
fn radix_conversion_rounds_before_wrapping_to_signed_integers() {
    assert_eq!(
        text(
            "return table.concat({tonumber('4294967295',10),tonumber('9007199254740993',10),tonumber('9007199254740995',10),tonumber('18446744073709551617',10),tonumber(string.rep('9',400),10)},',')"
        ),
        "-1,0,4,0,0"
    );
}

#[test]
fn explicit_radix_requires_a_string_and_accepts_numeric_string_bases() {
    assert!(
        Runtime::new(100_000)
            .run("return tonumber(12,10)", "radix.lua")
            .is_err()
    );
    assert_eq!(
        Runtime::new(100_000)
            .run("return tonumber('11','2')", "radix.lua")
            .unwrap(),
        vec![Value::Integer(3)]
    );
}

#[test]
fn radix_conversion_preserves_binary_and_generic_rounding() {
    assert_eq!(
        text(
            "return table.concat({tonumber('100000000000000000000000000000000000000000000000000011',2),tonumber('10000000000000000000000000000000000011111111111111111011',2),tonumber('100000000000000000000000000000000000000000000000000001000000000000000000000000001',2),tonumber('200000000000000000000000003',4),tonumber('2000000000000000003333333323',4),tonumber('10000000000000000000000000020000000000001',4),tonumber('400000000000000003',8),tonumber('2000000000003777773',8),tonumber('400000000000000001000000001',8),tonumber('20000000000003',16),tonumber('800000000ffffb',16),tonumber('100000000000008000001',16),tonumber('80000000003',32),tonumber('10000000vvvr',32),tonumber('10000000000400001',32)},',')"
        ),
        "4,1048568,268435456,4,1048568,268435456,4,1048568,268435456,4,1048568,268435456,4,1048568,268435456"
    );
    assert_eq!(
        text(
            "return table.concat({tonumber('1121202011211211122211100012101122',3),tonumber('20110222201101100122101100001221001',3),tonumber('120011012120222220121220221021201222212012102021111',3),tonumber('33421042423033203202440',5),tonumber('300234331302244110400124',5),tonumber('20143014114300212012041311041031110',5),tonumber('224404414114114022455',6),tonumber('1350430504504542425431',6),tonumber('5245102433414021100552522123321',6),tonumber('5350140446150306060',7),tonumber('31060622454003461341',7),tonumber('24253152245551365630663452116',7),tonumber('47664754584305348',9),tonumber('213881340571301831',9),tonumber('16135528817827251885172244',9),tonumber('2179a75830112630',11),tonumber('8696981010aa6096',11),tonumber('1393a9a31546a77675806609',11),tonumber('702273685b77a2b',12),tonumber('2408a522a0292277',12),tonumber('2234061042a88628a650541',12),tonumber('2397b7325802699',13),tonumber('91c572c998b6462',13),tonumber('4b7c364ba2202b0a913b95',13),tonumber('b4c34aaccadc67',14),tonumber('3356d5119b13991',14),tonumber('10640237523359bb47490d',14),tonumber('4964cdca1dc7b5',15),tonumber('137a46a5a910b44',15),tonumber('39801867ac6e5023d0e8a',15),tonumber('f7ded8c9e1f91',17),tonumber('3ae4830g610163',17),tonumber('50g6c8d899980b1aa00a',17),tonumber('7e2c925c889fh',18),tonumber('1d2ae094e7fhf1',18),tonumber('1cd0h57c7833h9185g6d',18),tonumber('416210bi7ca4d',19),tonumber('g558429h0d0b1',19),tonumber('bbb48haf1bcig9f6fc9',19),tonumber('23jc3e8722c9f',20),tonumber('8fi8ehd8f1b6j',20),tonumber('4c4d9f53beg92j0f9f5',20),tonumber('14f01e5ec7fde',21),tonumber('4ii06f1gci461',21),tonumber('1j5187gaafj9fjd7i0d',21),tonumber('f92hf53a8ccb',22),tonumber('2heb4gke20gfh',22),tonumber('i5a03g849bff8b0i09',22),tonumber('9a9i7gmkbfj9',23),tonumber('1eig47lmghlc2',23),tonumber('8d3036j7g0gklika9i',23),tonumber('5m1bec25hbdb',24),tonumber('ng5ma0921ifj',24),tonumber('43ie39h1l4j03mjd81',24),tonumber('3jb4ed3h3aek',25),tonumber('f2ji82el5k1e',25),tonumber('21n1l9f271alg5l365',25),tonumber('2bko8jf78bb9',26),tonumber('9l5j9095famf',26),tonumber('11ik3f5315lgg38fo5',26),tonumber('1gk4mmhm95ah',27),tonumber('6cqja9ha91p1',27),tonumber('f45fqogop7jqn5b7d',27),tonumber('12bd1h7b56h7',28),tonumber('49ho6d1icjpf',28),tonumber('8d485aa61eblg5n7d',28),tonumber('lbpf6d7shie',29),tonumber('2rif2po4cca4',29),tonumber('4o2nnbskj3i4rkhf7',29),tonumber('f7iboftrod5',30),tonumber('210dh84102oj',30),tonumber('2o7gr6ar4l6ar1tqp',30),tonumber('aukoap6alib',31),tonumber('1ctl4c7qfues',31),tonumber('1kg3gjkpafstug656',31),tonumber('5t2d3e17rjb',33),tonumber('nh9jdn5rh6s',33),tonumber('k5jbmgrnind2ae3v',33),tonumber('4cbreicjcd1',34),tonumber('hfd7o5h24k3',34),tonumber('cu7jcqqqhvqkstpr',34),tonumber('399uaj5f5w0',35),tonumber('d24g76mf4lt',35),tonumber('8c1hua4i5k9q60bk',35),tonumber('2gosa7pa2gz',36),tonumber('9ur54utqqyj',36),tonumber('5gv2rma270zhe8ld',36)},',')"
        ),
        "4,1048568,0,4,1048576,268435456,4,1048568,0,4,1048576,0,4,1048576,268435456,4,1048568,268435456,4,1048568,268435456,4,1048568,0,4,1048568,268435456,4,1048568,268435456,4,1048568,268435456,4,1048576,0,4,1048568,0,4,1048568,0,4,1048568,0,4,1048568,0,4,1048568,268435456,4,1048568,268435456,4,1048568,268435456,4,1048568,268435456,4,1048576,268435456,4,1048568,268435456,4,1048576,0,4,1048568,268435456,4,1048576,0,4,1048576,268435456,4,1048568,0,4,1048576,0,4,1048568,0"
    );
}

#[test]
fn explicit_radix_errors_keep_reference_messages_without_source_locations() {
    for (source, expected) in [
        ("return tonumber(12,10)", "Expected Lua string"),
        ("return tonumber('1',1)", "base out of range"),
        (
            "return tonumber('1',2.5)",
            "Number has no integer representation",
        ),
        ("return tonumber('1',false)", "Expected Lua number"),
    ] {
        assert_eq!(
            Runtime::new(100_000)
                .run(source, "radix.lua")
                .unwrap_err()
                .to_string(),
            expected
        );
    }
}
