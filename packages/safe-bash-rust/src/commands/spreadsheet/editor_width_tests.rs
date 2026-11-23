// Width cases from Apache OpenOffice's Excel ASC/JIS specification and
// widthfolding_data.h, revision 34a6fe28 (Apache-2.0; LICENSE.OpenOffice,
// NOTICE.OpenOffice). Space conversions follow IronCalc/Univer.
use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn width_ascii_katakana_and_japanese_punctuation() {
    let mut book = Spreadsheet::new();
    for (source, expected) in [
        (r#"=ASC("ＡＢＣ　１２３")"#, "ABC 123"),
        (r#"=DBCS("abc 123")"#, "ａｂｃ　１２３"),
        (r#"=JIS("abc 123")"#, "ａｂｃ　１２３"),
        (
            r#"=ASC("ガギグゲゴ ザジズゼゾ ダヂヅデド バビブベボ パピプペポ ヴヷヸヹヺ")"#,
            "ｶﾞｷﾞｸﾞｹﾞｺﾞ ｻﾞｼﾞｽﾞｾﾞｿﾞ ﾀﾞﾁﾞﾂﾞﾃﾞﾄﾞ ﾊﾞﾋﾞﾌﾞﾍﾞﾎﾞ ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ ｳﾞﾜﾞヰﾞヱﾞｦﾞ",
        ),
        (
            r#"=DBCS("ｶﾞｷﾞｸﾞｹﾞｺﾞ ｻﾞｼﾞｽﾞｾﾞｿﾞ ﾀﾞﾁﾞﾂﾞﾃﾞﾄﾞ ﾊﾞﾋﾞﾌﾞﾍﾞﾎﾞ ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ ｳﾞﾜﾞｦﾞ")"#,
            "ガギグゲゴ　ザジズゼゾ　ダヂヅデド　バビブベボ　パピプペポ　ウ゛ヷヺ",
        ),
        (
            r#"=ASC("「アイウエオ。ァィゥェォ、ャュョッ・ー」")"#,
            "｢ｱｲｳｴｵ｡ｧｨｩｪｫ､ｬｭｮｯ･ｰ｣",
        ),
        (
            r#"=JIS("｢ｱｲｳｴｵ｡ｧｨｩｪｫ､ｬｭｮｯ･ｰ｣")"#,
            "「アイウエオ。ァィゥェォ、ャュョッ・ー」",
        ),
        (r#"=ASC("中文ひらがな한국인😀é")"#, "中文ひらがな한국인😀é"),
        (r#"=DBCS("中文ひらがな한국인😀é")"#, "中文ひらがな한국인😀é"),
        (r#"=ASC("‘’”￥―")"#, r#"`'"\ｰ"#),
    ] {
        book.edit(&[(0, 0, 0, source)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{source}");
    }
    book.edit(&[(0, 0, 0, "\"'\\`"), (0, 0, 1, "=JIS(A1)")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "”’￥‘");
}

#[test]
fn width_marks_combine_only_valid_adjacent_pairs() {
    let mut book = Spreadsheet::new();
    for (input, expected) in [
        ("か゛か゜う゛は゜", "がか゜ゔぱ"),
        ("カ\u{3099}ハ\u{309a}ウ\u{3099}", "ガパウ\u{3099}"),
        ("ｶﾞﾞﾊﾟﾟｱﾞｶﾟﾞ", "ガ゛パ゜ア゛カ゜゛"),
        ("ﾞﾟ", "゛゜"),
        ("ヰ゛ヱ゛", "ヸヹ"),
    ] {
        book.edit(&[(0, 0, 0, input), (0, 0, 1, "=DBCS(A1)")], LIMIT)
            .unwrap();
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), expected, "{input}");
    }
    book.edit(&[(0, 0, 0, "=ASC(\"カ\u{3099}がヴ\")")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "ｶ\u{3099}がｳﾞ");
}

#[test]
fn width_coercion_errors_arrays_and_arity() {
    let mut book = Spreadsheet::new();
    for (name, values) in [
        ("ASC", ["1", "TRUE", "", "#N/A", "1.23", "FALSE"]),
        (
            "DBCS",
            ["１", "ＴＲＵＥ", "", "#N/A", "１．２３", "ＦＡＬＳＥ"],
        ),
        (
            "JIS",
            ["１", "ＴＲＵＥ", "", "#N/A", "１．２３", "ＦＡＬＳＥ"],
        ),
    ] {
        book.edit(
            &[
                (0, 0, 0, "1"),
                (0, 0, 1, "TRUE"),
                (0, 1, 0, "#N/A"),
                (0, 1, 1, "1.23"),
                (0, 1, 2, "FALSE"),
                (0, 0, 4, &format!("={name}(A1:C2)")),
            ],
            LIMIT,
        )
        .unwrap();
        for (i, want) in values.iter().enumerate() {
            assert_eq!(
                book.display(0, i / 3, 4 + i % 3, LIMIT).unwrap(),
                *want,
                "{name} {i}"
            );
            if i != 3 {
                assert!(matches!(
                    book.cell(0, i / 3, 4 + i % 3).unwrap().value,
                    Some(Value::Text(_))
                ));
            }
        }
        for args in ["", "1,2", "#N/A,2"] {
            book.edit(&[(0, 4, 0, &format!("={name}({args})"))], LIMIT)
                .unwrap();
            assert_eq!(book.display(0, 4, 0, LIMIT).unwrap(), "#ERROR!");
        }
    }
}

#[test]
fn width_tables_recalculate_after_json_excel_and_source_edits() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Label"),
            (0, 1, 0, "ガＡ"),
            (0, 2, 0, "パＢ"),
            (0, 1, 3, "=DBCS(B2:B3)"),
            (0, 1, 4, "=JIS(B2:B3)"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Labels", [0, 0, 2, 0], LIMIT).unwrap();
    book.edit(&[(0, 1, 1, "=ASC(Labels[Label])")], LIMIT)
        .unwrap();
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(reopened.display(0, 2, 1, LIMIT).unwrap(), "ﾊﾟB");
        for c in [3, 4] {
            assert_eq!(reopened.display(0, 2, c, LIMIT).unwrap(), "パＢ");
        }
        reopened.edit(&[(0, 2, 0, "グＣ")], LIMIT).unwrap();
        assert_eq!(reopened.display(0, 2, 1, LIMIT).unwrap(), "ｸﾞC");
        for c in [3, 4] {
            assert_eq!(reopened.display(0, 2, c, LIMIT).unwrap(), "グＣ");
        }
    }
}

#[test]
fn width_utf16_expansion_and_failed_edits_are_bounded() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=LEN(ASC(REPT(\"ガ\",16383)&\"Ａ\"))", "32767"),
        ("=ASC(REPT(\"ガ\",16384))", "#VALUE!"),
        ("=LEN(DBCS(REPT(\"a\",32767)))", "32767"),
        ("=LEN(ASC(REPT(\"😀\",16383)&\"Ａ\"))", "16384"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    book.edit(
        &[(0, 0, 0, "unchanged"), (0, 0, 2, &"ガ".repeat(5000))],
        LIMIT,
    )
    .unwrap();
    let before = book.to_json();
    for name in ["ASC", "DBCS", "JIS"] {
        assert!(
            book.edit(
                &[
                    (0, 0, 0, "changed"),
                    (0, 0, 1, &format!("={name}(IF(SEQUENCE(100)>0,$C$1))"))
                ],
                200_000
            )
            .is_err()
        );
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn width_complete_pinned_openoffice_conversion_tables() {
    // Complete applicable direct, decomposition and composition mappings from
    // the pinned upstream tables, joined by a non-converting emoji delimiter.
    let mut book = Spreadsheet::new();
    for (name, input, expected) in [
        (
            "ASC",
            "―🙂‘🙂’🙂”🙂、🙂。🙂「🙂」🙂゛🙂゜🙂ァ🙂ア🙂ィ🙂イ🙂ゥ🙂ウ🙂ェ🙂エ🙂ォ🙂オ🙂カ🙂キ🙂ク🙂ケ🙂コ🙂サ🙂シ🙂ス🙂セ🙂ソ🙂タ🙂チ🙂ッ🙂ツ🙂テ🙂ト🙂ナ🙂ニ🙂ヌ🙂ネ🙂ノ🙂ハ🙂ヒ🙂フ🙂ヘ🙂ホ🙂マ🙂ミ🙂ム🙂メ🙂モ🙂ャ🙂ヤ🙂ュ🙂ユ🙂ョ🙂ヨ🙂ラ🙂リ🙂ル🙂レ🙂ロ🙂ワ🙂ヲ🙂ン🙂・🙂ー🙂！🙂＂🙂＃🙂＄🙂％🙂＆🙂＇🙂（🙂）🙂＊🙂＋🙂，🙂－🙂．🙂／🙂０🙂１🙂２🙂３🙂４🙂５🙂６🙂７🙂８🙂９🙂：🙂；🙂＜🙂＝🙂＞🙂？🙂＠🙂Ａ🙂Ｂ🙂Ｃ🙂Ｄ🙂Ｅ🙂Ｆ🙂Ｇ🙂Ｈ🙂Ｉ🙂Ｊ🙂Ｋ🙂Ｌ🙂Ｍ🙂Ｎ🙂Ｏ🙂Ｐ🙂Ｑ🙂Ｒ🙂Ｓ🙂Ｔ🙂Ｕ🙂Ｖ🙂Ｗ🙂Ｘ🙂Ｙ🙂Ｚ🙂［🙂＼🙂］🙂＾🙂＿🙂｀🙂ａ🙂ｂ🙂ｃ🙂ｄ🙂ｅ🙂ｆ🙂ｇ🙂ｈ🙂ｉ🙂ｊ🙂ｋ🙂ｌ🙂ｍ🙂ｎ🙂ｏ🙂ｐ🙂ｑ🙂ｒ🙂ｓ🙂ｔ🙂ｕ🙂ｖ🙂ｗ🙂ｘ🙂ｙ🙂ｚ🙂｛🙂｜🙂｝🙂～",
            "ｰ🙂`🙂'🙂\"🙂､🙂｡🙂｢🙂｣🙂ﾞ🙂ﾟ🙂ｧ🙂ｱ🙂ｨ🙂ｲ🙂ｩ🙂ｳ🙂ｪ🙂ｴ🙂ｫ🙂ｵ🙂ｶ🙂ｷ🙂ｸ🙂ｹ🙂ｺ🙂ｻ🙂ｼ🙂ｽ🙂ｾ🙂ｿ🙂ﾀ🙂ﾁ🙂ｯ🙂ﾂ🙂ﾃ🙂ﾄ🙂ﾅ🙂ﾆ🙂ﾇ🙂ﾈ🙂ﾉ🙂ﾊ🙂ﾋ🙂ﾌ🙂ﾍ🙂ﾎ🙂ﾏ🙂ﾐ🙂ﾑ🙂ﾒ🙂ﾓ🙂ｬ🙂ﾔ🙂ｭ🙂ﾕ🙂ｮ🙂ﾖ🙂ﾗ🙂ﾘ🙂ﾙ🙂ﾚ🙂ﾛ🙂ﾜ🙂ｦ🙂ﾝ🙂･🙂ｰ🙂!🙂\"🙂#🙂$🙂%🙂&🙂'🙂(🙂)🙂*🙂+🙂,🙂-🙂.🙂/🙂0🙂1🙂2🙂3🙂4🙂5🙂6🙂7🙂8🙂9🙂:🙂;🙂<🙂=🙂>🙂?🙂@🙂A🙂B🙂C🙂D🙂E🙂F🙂G🙂H🙂I🙂J🙂K🙂L🙂M🙂N🙂O🙂P🙂Q🙂R🙂S🙂T🙂U🙂V🙂W🙂X🙂Y🙂Z🙂[🙂\\🙂]🙂^🙂_🙂`🙂a🙂b🙂c🙂d🙂e🙂f🙂g🙂h🙂i🙂j🙂k🙂l🙂m🙂n🙂o🙂p🙂q🙂r🙂s🙂t🙂u🙂v🙂w🙂x🙂y🙂z🙂{🙂|🙂}🙂~",
        ),
        (
            "JIS",
            "!🙂#🙂$🙂%🙂&🙂(🙂)🙂*🙂+🙂,🙂.🙂/🙂0🙂1🙂2🙂3🙂4🙂5🙂6🙂7🙂8🙂9🙂:🙂;🙂<🙂=🙂>🙂?🙂@🙂A🙂B🙂C🙂D🙂E🙂F🙂G🙂H🙂I🙂J🙂K🙂L🙂M🙂N🙂O🙂P🙂Q🙂R🙂S🙂T🙂U🙂V🙂W🙂X🙂Y🙂Z🙂[🙂]🙂^🙂_🙂a🙂b🙂c🙂d🙂e🙂f🙂g🙂h🙂i🙂j🙂k🙂l🙂m🙂n🙂o🙂p🙂q🙂r🙂s🙂t🙂u🙂v🙂w🙂x🙂y🙂z🙂{🙂|🙂}🙂~🙂｡🙂｢🙂｣🙂､🙂･🙂ｦ🙂ｧ🙂ｨ🙂ｩ🙂ｪ🙂ｫ🙂ｬ🙂ｭ🙂ｮ🙂ｯ🙂ｰ🙂ｱ🙂ｲ🙂ｳ🙂ｴ🙂ｵ🙂ｶ🙂ｷ🙂ｸ🙂ｹ🙂ｺ🙂ｻ🙂ｼ🙂ｽ🙂ｾ🙂ｿ🙂ﾀ🙂ﾁ🙂ﾂ🙂ﾃ🙂ﾄ🙂ﾅ🙂ﾆ🙂ﾇ🙂ﾈ🙂ﾉ🙂ﾊ🙂ﾋ🙂ﾌ🙂ﾍ🙂ﾎ🙂ﾏ🙂ﾐ🙂ﾑ🙂ﾒ🙂ﾓ🙂ﾔ🙂ﾕ🙂ﾖ🙂ﾗ🙂ﾘ🙂ﾙ🙂ﾚ🙂ﾛ🙂ﾜ🙂ﾝ🙂ﾞ🙂ﾟ",
            "！🙂＃🙂＄🙂％🙂＆🙂（🙂）🙂＊🙂＋🙂，🙂．🙂／🙂０🙂１🙂２🙂３🙂４🙂５🙂６🙂７🙂８🙂９🙂：🙂；🙂＜🙂＝🙂＞🙂？🙂＠🙂Ａ🙂Ｂ🙂Ｃ🙂Ｄ🙂Ｅ🙂Ｆ🙂Ｇ🙂Ｈ🙂Ｉ🙂Ｊ🙂Ｋ🙂Ｌ🙂Ｍ🙂Ｎ🙂Ｏ🙂Ｐ🙂Ｑ🙂Ｒ🙂Ｓ🙂Ｔ🙂Ｕ🙂Ｖ🙂Ｗ🙂Ｘ🙂Ｙ🙂Ｚ🙂［🙂］🙂＾🙂＿🙂ａ🙂ｂ🙂ｃ🙂ｄ🙂ｅ🙂ｆ🙂ｇ🙂ｈ🙂ｉ🙂ｊ🙂ｋ🙂ｌ🙂ｍ🙂ｎ🙂ｏ🙂ｐ🙂ｑ🙂ｒ🙂ｓ🙂ｔ🙂ｕ🙂ｖ🙂ｗ🙂ｘ🙂ｙ🙂ｚ🙂｛🙂｜🙂｝🙂～🙂。🙂「🙂」🙂、🙂・🙂ヲ🙂ァ🙂ィ🙂ゥ🙂ェ🙂ォ🙂ャ🙂ュ🙂ョ🙂ッ🙂ー🙂ア🙂イ🙂ウ🙂エ🙂オ🙂カ🙂キ🙂ク🙂ケ🙂コ🙂サ🙂シ🙂ス🙂セ🙂ソ🙂タ🙂チ🙂ツ🙂テ🙂ト🙂ナ🙂ニ🙂ヌ🙂ネ🙂ノ🙂ハ🙂ヒ🙂フ🙂ヘ🙂ホ🙂マ🙂ミ🙂ム🙂メ🙂モ🙂ヤ🙂ユ🙂ヨ🙂ラ🙂リ🙂ル🙂レ🙂ロ🙂ワ🙂ン🙂゛🙂゜",
        ),
        (
            "ASC",
            "ガ🙂ギ🙂グ🙂ゲ🙂ゴ🙂ザ🙂ジ🙂ズ🙂ゼ🙂ゾ🙂ダ🙂ヂ🙂ヅ🙂デ🙂ド🙂バ🙂パ🙂ビ🙂ピ🙂ブ🙂プ🙂ベ🙂ペ🙂ボ🙂ポ🙂ヴ🙂ヷ🙂ヸ🙂ヹ🙂ヺ",
            "ｶﾞ🙂ｷﾞ🙂ｸﾞ🙂ｹﾞ🙂ｺﾞ🙂ｻﾞ🙂ｼﾞ🙂ｽﾞ🙂ｾﾞ🙂ｿﾞ🙂ﾀﾞ🙂ﾁﾞ🙂ﾂﾞ🙂ﾃﾞ🙂ﾄﾞ🙂ﾊﾞ🙂ﾊﾟ🙂ﾋﾞ🙂ﾋﾟ🙂ﾌﾞ🙂ﾌﾟ🙂ﾍﾞ🙂ﾍﾟ🙂ﾎﾞ🙂ﾎﾟ🙂ｳﾞ🙂ﾜﾞ🙂ヰﾞ🙂ヱﾞ🙂ｦﾞ",
        ),
        (
            "JIS",
            "ゔ🙂う゛🙂が🙂か゛🙂ぎ🙂き゛🙂ぐ🙂く゛🙂げ🙂け゛🙂ご🙂こ゛🙂ざ🙂さ゛🙂じ🙂し゛🙂ず🙂す゛🙂ぜ🙂せ゛🙂ぞ🙂そ゛🙂だ🙂た゛🙂ぢ🙂ち゛🙂づ🙂つ゛🙂で🙂て゛🙂ど🙂と゛🙂ば🙂は゛🙂ぱ🙂は゜🙂び🙂ひ゛🙂ぴ🙂ひ゜🙂ぶ🙂ふ゛🙂ぷ🙂ふ゜🙂べ🙂へ゛🙂ぺ🙂へ゜🙂ぼ🙂ほ゛🙂ぽ🙂ほ゜🙂ガ🙂カ゛🙂ギ🙂キ゛🙂グ🙂ク゛🙂ゲ🙂ケ゛🙂ゴ🙂コ゛🙂ザ🙂サ゛🙂ジ🙂シ゛🙂ズ🙂ス゛🙂ゼ🙂セ゛🙂ゾ🙂ソ゛🙂ダ🙂タ゛🙂ヂ🙂チ゛🙂ヅ🙂ツ゛🙂デ🙂テ゛🙂ド🙂ト゛🙂バ🙂ハ゛🙂パ🙂ハ゜🙂ビ🙂ヒ゛🙂ピ🙂ヒ゜🙂ブ🙂フ゛🙂プ🙂フ゜🙂ベ🙂ヘ゛🙂ペ🙂ヘ゜🙂ボ🙂ホ゛🙂ポ🙂ホ゜🙂ヷ🙂ワ゛🙂ヸ🙂ヰ゛🙂ヹ🙂ヱ゛🙂ヺ🙂ヲ゛",
            "ゔ🙂ゔ🙂が🙂が🙂ぎ🙂ぎ🙂ぐ🙂ぐ🙂げ🙂げ🙂ご🙂ご🙂ざ🙂ざ🙂じ🙂じ🙂ず🙂ず🙂ぜ🙂ぜ🙂ぞ🙂ぞ🙂だ🙂だ🙂ぢ🙂ぢ🙂づ🙂づ🙂で🙂で🙂ど🙂ど🙂ば🙂ば🙂ぱ🙂ぱ🙂び🙂び🙂ぴ🙂ぴ🙂ぶ🙂ぶ🙂ぷ🙂ぷ🙂べ🙂べ🙂ぺ🙂ぺ🙂ぼ🙂ぼ🙂ぽ🙂ぽ🙂ガ🙂ガ🙂ギ🙂ギ🙂グ🙂グ🙂ゲ🙂ゲ🙂ゴ🙂ゴ🙂ザ🙂ザ🙂ジ🙂ジ🙂ズ🙂ズ🙂ゼ🙂ゼ🙂ゾ🙂ゾ🙂ダ🙂ダ🙂ヂ🙂ヂ🙂ヅ🙂ヅ🙂デ🙂デ🙂ド🙂ド🙂バ🙂バ🙂パ🙂パ🙂ビ🙂ビ🙂ピ🙂ピ🙂ブ🙂ブ🙂プ🙂プ🙂ベ🙂ベ🙂ペ🙂ペ🙂ボ🙂ボ🙂ポ🙂ポ🙂ヷ🙂ヷ🙂ヸ🙂ヸ🙂ヹ🙂ヹ🙂ヺ🙂ヺ",
        ),
    ] {
        book.edit(
            &[(0, 0, 0, input), (0, 0, 1, &format!("={name}(A1)"))],
            LIMIT,
        )
        .unwrap();
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), expected, "{name}");
    }
}
