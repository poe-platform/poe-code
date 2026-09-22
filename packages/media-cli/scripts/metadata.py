"""Generate advisory metadata from the registered FFmpeg release, never from help.
Run --check to detect register or generated-output drift. No native process runs.
"""
import csv
import hashlib
import json
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parent.parent
ROOT = PACKAGE.parent.parent
LOCK = json.loads((PACKAGE / 'metadata-lock.json').read_text())
for name, digest in LOCK['registers'].items():
    if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest:
        raise SystemExit('Register drift; review source/license/build before updating: ' + name)
rows = list(csv.DictReader((PACKAGE / 'metadata/option-tables.csv').open()))
source_files = list(csv.DictReader((PACKAGE / 'metadata/source-files.csv').open()))
# Codec dictionaries are matched against native stream metadata, even when
# their command-line keys have no specifier. Pin both consumers in cmdutils.c.
if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == 'fftools/cmdutils.c'
           and r['sha256'] == 'd21c11d724bb9bcca498c3aeb589113577ed280441a91ba39a9ce0fde59e0b40'
           for r in source_files):
    raise SystemExit('Codec dictionary stream matching grammar source drift')
# Callback behavior is implementation grammar, not nominal OptionDef arity.
# Review retained-input and propagated-error predictions on a source change.
probe_source = next(r for r in source_files if r['source_set'] == 'ffmpeg-release'
                    and r['path'] == 'fftools/ffprobe.c')
if probe_source['sha256'] != '8c8b5ab6d34bb2b6fde8ce7411bb8f7beef708a436883b2da9f3acbb1986d0de':
    raise SystemExit('ffprobe filename callback grammar source drift')
# Empty attachment destinations select a stream filename tag at input-open
# time, independently of whether the CLI spelling contains a stream suffix.
if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == 'fftools/ffmpeg_demux.c'
           and r['sha256'] == 'dc93432c079e458fa41179e1f8985dab00df80edbadb2c59a35a78ca340c7584'
           for r in source_files):
    raise SystemExit('Attachment metadata filename grammar source drift')
# Sequence expansion precedes AVIO protocol selection; globbing instead uses
# the literal local namespace. These rules are implementation, not help text.
for path, digest in [
    ('libavformat/img2dec.c', '0bf6cde0df92996a3c9cf5e2c8e519ed775073d4db8b2c5dd896cd46771917e7'),
    ('libavformat/img2enc.c', 'b39ab0cc458ed5204df48bdb46a8c41c056daf9be19541a9ce2d342481313eb0'),
]:
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('Image2 AVIO filename grammar source drift: ' + path)
options = {'ffmpeg': {}, 'ffprobe': {}}
# Tee slave filenames bypass the CLI dash-to-stdout rewrite. Pin both the
# filename parser and its actual AVIO-open consumer, rather than help syntax.
for path, digest in [
    ('libavformat/tee.c', 'c49e3cada082aa8ff7c39e3c0f0ecb160a63f1c1d2bfd59a154bd943e4cbce88'),
    ('libavformat/tee_common.c', '70ec256202cc21b2cb253102840c2515309315dbc587180d28215c36702991a9'),
    ('libavformat/mux_utils.c', '47b9aca2cb145c41a8b3b0553353361bca780c21778faa5b12a8e988ecef4d68'),
    ('libavformat/options.c', '1a0cba6a08d14ed6a46e764e6b62fbc69bd6119e3d77177c5f9eaf7a805fb2ef'),
]:
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('Tee slave AVIO filename grammar source drift: ' + path)
# Simple filter alias handlers and last-match selection are implementation
# grammar. Do not silently carry these predictions over a changed consumer.
for path, digest in [
    ('fftools/ffmpeg_opt.c', '9b452dd88d471954e745fa9b74e4d501ae7438e4dde0228b0031bd9e4b08940b'),
    ('fftools/ffmpeg_mux_init.c', 'cc55fac3a9e6d37bc2ad682ddd01716e4e79d15f16e53bad7e347886b74c6c8c'),
]:
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('Simple filter selection grammar source drift: ' + path)
avoptions = set()
codec_options = set()
codec_child_options = set()
for row in rows:
    if row['source_set'] != 'ffmpeg-release':
        continue
    kind, path = row['table_kind'], row['path']
    if kind == 'AVOption':
        # cmdutils.c opt_find rejects options with no flags. An empty register
        # field can mean a designated initializer, so only explicit zero is
        # conclusive here; other inventory uncertainty stays advisory.
        if row['scope_flags'] == '0':
            continue
        if path.startswith('libavcodec/') and row['type'] != 'AV_OPT_TYPE_CONST':
            codec_child_options.add(row['name'])
        if path.startswith(('libavcodec/', 'libavformat/', 'libswscale/', 'libswresample/')) and row['type'] != 'AV_OPT_TYPE_CONST':
            avoptions.add(row['name'])
        # opt_default's legacy v/a/s fallback searches the codec class itself,
        # without AV_OPT_SEARCH_CHILDREN and without stripping stream suffixes.
        if path == 'libavcodec/options_table.h' and row['type'] != 'AV_OPT_TYPE_CONST' and row['scope_flags'] not in ('', '0'):
            codec_options.add(row['name'])
        continue
    if kind not in ('OptionDef', 'CommonOptionDef'):
        continue
    targets = ['ffmpeg', 'ffprobe'] if kind == 'CommonOptionDef' else ['ffmpeg' if path.endswith('ffmpeg_opt.c') else 'ffprobe']
    flags = row['scope_flags'].split(' | ')
    entry = {'arity': int(row['arity'].split(';')[0]), 'boolean': row['type'] == 'OPT_TYPE_BOOL',
             'exit': 'OPT_EXIT' in flags,
             'perFile': any(f in flags for f in ('OPT_PERFILE', 'OPT_OFFSET', 'OPT_SPEC', 'OPT_PERSTREAM')),
             'perStream': 'OPT_PERSTREAM' in flags,
             'scopes': [scope for scope in ('input', 'output', 'decoder') if 'OPT_' + scope.upper() in flags],
             'source': path + ':' + row['line']}
    for target in targets:
        options[target][row['name']] = entry
result = '// Generated by scripts/metadata.py; source-derived, LGPL/GPL notices in NOTICE.\n'
result += 'export const optionMetadata = ' + json.dumps(options, indent=2) + ' as const;\n'
result += 'export const avOptionNames: readonly string[] = ' + json.dumps(sorted(avoptions)) + ';\n'
result += 'export const avCodecOptionNames: readonly string[] = ' + json.dumps(sorted(codec_options)) + ';\n'
result += 'export const avCodecChildOptionNames: readonly string[] = ' + json.dumps(sorted(codec_child_options)) + ';\n'
# Reader syntax is implementation evidence, not an inference from help text.
# AVIO does not interpret '-' as stdio unless the caller rewrites it.
path_options = {}
for name, role, access, syntax, path in [
    ('fpre', 'preset', 'read', 'literal', 'fftools/ffmpeg_opt.c'),
    ('attach', 'attachment', 'read', 'avio', 'fftools/ffmpeg_mux_init.c'),
    ('dump_attachment', 'attachment', 'write', 'avio', 'fftools/ffmpeg_demux.c'),
    ('progress', 'sidecar', 'write', 'stdio', 'fftools/ffmpeg_opt.c'),
    ('sdp_file', 'sidecar', 'write', 'avio', 'fftools/ffmpeg_mux.c'),
    ('stats_enc_pre', 'sidecar', 'write', 'avio', 'fftools/ffmpeg_mux_init.c'),
    ('stats_enc_post', 'sidecar', 'write', 'avio', 'fftools/ffmpeg_mux_init.c'),
    ('stats_mux_pre', 'sidecar', 'write', 'avio', 'fftools/ffmpeg_mux_init.c'),
    ('vstats_file', 'sidecar', 'write', 'literal', 'fftools/ffmpeg_enc.c'),
    ('passlogfile', 'sidecar', 'read-write', 'generated', 'fftools/ffmpeg_mux_init.c'),
    ('hls_segment_filename', 'sidecar', 'write', 'avio', 'libavformat/hlsenc.c'),
    ('hls_key_info_file', 'sidecar', 'read', 'avio', 'libavformat/hlsenc.c'),
    ('segment_list', 'sidecar', 'write', 'avio', 'libavformat/segment.c'),
    ('segment_header_filename', 'sidecar', 'write', 'avio', 'libavformat/segment.c'),
]:
    if name not in options['ffmpeg'] and name not in avoptions:
        raise SystemExit('Path option inventory drift: ' + name)
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path for r in source_files):
        raise SystemExit('Path reader source inventory drift: ' + path)
    path_options[name] = {'role': role, 'access': access, 'syntax': syntax, 'source': path}
result += 'export const pathOptionMetadata = ' + json.dumps(path_options, indent=2) + ' as const;\n'
# Access semantics require the implementation, not just an option's help/type:
# f_metadata.c uses avio_open(WRITE); vf_psnr.c/vf_ssim.c use fopen("w")
# with a stdout special case. Inventory and positional names come from the pin.
filter_outputs = {}
# vf_curves.c aliases share offsets; avfilter.c skips adjacent aliases in
# shorthand. Readers are av_file_map(psfile) and fopen(plot, "w").
curves_path = 'libavfilter/vf_curves.c'
curves_source = next(r for r in source_files if r['source_set'] == 'ffmpeg-release' and r['path'] == curves_path)
if curves_source['sha256'] != 'aac8933aee9ee5939b997da31d321205c98dbc9e06c37d826574fc888d3e753a':
    raise SystemExit('Curves reader/offset grammar source drift')
curves_fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
                 and r['path'] == curves_path and r['table_kind'] == 'AVOption'
                 and r['type'] != 'AV_OPT_TYPE_CONST' and r['name'] not in ('m', 'r', 'g', 'b')]
if not {'psfile', 'plot'}.issubset(curves_fields):
    raise SystemExit('Curves reader option inventory drift')
filter_outputs['curves'] = {'keys': ['plot'], 'positional': curves_fields,
                            'literal': True, 'stdout': False, 'generated': False,
                            'source': curves_path}
for filters, path, keys, literal, stdout, generated in [
    (['metadata', 'ametadata'], 'libavfilter/f_metadata.c', ['file'], False, True, False),
    (['psnr'], 'libavfilter/vf_psnr.c', ['stats_file', 'f'], True, True, False),
    (['ssim'], 'libavfilter/vf_ssim.c', ['stats_file', 'f'], True, True, False),
    (['vmafmotion'], 'libavfilter/vf_vmafmotion.c', ['stats_file'], True, True, False),
    (['deshake'], 'libavfilter/vf_deshake.c', ['filename'], True, False, False),
    # load_palette calls disp_tree's literal filename writer at frame time.
    # The native caller deliberately ignores the optional diagnostic failure.
    (['paletteuse'], 'libavfilter/vf_paletteuse.c', ['debug_kdtree'], True, False, False),
    # generate_kernel uses avpriv_fopen_utf8("w"), without a stdout alias.
    # Its optional diagnostic dump failure is handled by native processing.
    (['firequalizer'], 'libavfilter/af_firequalizer.c', ['dumpfile'], True, False, False),
    # uninit hands log_path to libvmaf's filename writer, without FFmpeg AVIO
    # or a stdout special case. Unset NULL disables logging; empty is explicit.
    (['libvmaf'], 'libavfilter/vf_libvmaf.c', ['log_path'], True, False, False),
    # export() uses literal fopen paths for one input and frame filename
    # expansion for multiple inputs. Empty filenames disable export entirely.
    (['signature'], 'libavfilter/vf_signature.c', ['filename'], True, False, True),
]:
    if path == 'libavfilter/vf_paletteuse.c' and not any(
            r['source_set'] == 'ffmpeg-release' and r['path'] == path
            and r['sha256'] == '6efe8e1fe6b797e89a6dc2f97aaf12fceffb8566da0ff67f9a3b18dadb8a22b7'
            for r in source_files):
        raise SystemExit('Paletteuse literal diagnostic writer grammar source drift')
    if path == 'libavfilter/af_firequalizer.c' and not any(
            r['source_set'] == 'ffmpeg-release' and r['path'] == path
            and r['sha256'] == '44e7049da6afe7fc664220547cc51940e54a2222722ef2594882f2d1b3f8e0c8'
            for r in source_files):
        raise SystemExit('Firequalizer literal dump writer grammar source drift')
    if path == 'libavfilter/vf_libvmaf.c' and not any(
            r['source_set'] == 'ffmpeg-release' and r['path'] == path
            and r['sha256'] == '6c6fa0392255074a2cfbd8bf0264ce53f442f66cb892ea154845eb735b7ea5c9'
            for r in source_files):
        raise SystemExit('libvmaf log writer grammar source drift')
    if path == 'libavfilter/vf_deshake.c' and not any(
            r['source_set'] == 'ffmpeg-release' and r['path'] == path
            and r['sha256'] == '77697979ce315a319b403577a69f26d5c70017cf62c1efaaaa5293e22b388e8e'
            for r in source_files):
        raise SystemExit('Deshake literal log writer grammar source drift')
    if path == 'libavfilter/vf_vmafmotion.c' and not any(
            r['source_set'] == 'ffmpeg-release' and r['path'] == path
            and r['sha256'] == 'bce67432a1e1cda81716b4fb0bd63412fabeabb3dcf7c7b7d797bb919e53ac51'
            for r in source_files):
        raise SystemExit('VMAF motion fopen/stdout reader grammar source drift')
    fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
              and r['path'] == path and r['table_kind'] == 'AVOption'
              and r['type'] != 'AV_OPT_TYPE_CONST']
    if not set(keys).issubset(fields):
        raise SystemExit('Filter output option inventory drift: ' + path)
    for name in filters:
        filter_outputs[name] = {'keys': keys, 'positional': [f for f in fields if f != 'f'],
                                'literal': literal, 'stdout': stdout,
                                'generated': generated, 'source': path}
# COMMON_OPTIONS is not represented by the lexical OptionDef/AVOption register.
# Retain its source identity and offset aliases explicitly; ff_filter_opt_parse
# skips adjacent options sharing an offset when selecting positional shorthand.
macro = json.loads((PACKAGE / 'filter-macros.json').read_text())
if not any(r['source_set'] == macro['source'] and r['path'] == macro['path']
           and r['sha256'] == macro['sha256'] for r in source_files):
    raise SystemExit('Filter macro source drift')
positional = []
offset = None
for field in macro['fields']:
    if field['offset'] != offset:
        positional.append(field['name'])
        offset = field['offset']
filter_inputs = {name: {
    'positional': positional,
    'keys': {'filename': literal, 'f': literal, 'fontsdir': True},
    'source': macro['path'] + ':' + str(macro['line']),
} for name, literal in [('subtitles', False), ('ass', True)]}
filter_inputs['curves'] = {'positional': curves_fields, 'keys': {'psfile': True},
                           'source': curves_path}
# DNN model is a child-class option, not positional shorthand in the filter
# table. Backend libraries select AVIO versus literal reads and companion files;
# retain a runtime lookup instead of asserting a complete model closure.
for path, digest in [
    ('libavfilter/dnn/dnn_interface.c', '070151d0806c0d186ae169beca47dd15403b398b3647c05815b41d19eb906804'),
    ('libavfilter/dnn_filter_common.c', '27371a0b9a5b9d305c997822dbc5e1f0181c09f802ceec6c3342ddd06c83d15a'),
    ('libavfilter/dnn/dnn_backend_tf.c', 'f5b41df0d0f3580425aa2bd2d394b0a47f263435ac1dc8a37ff8d18303013876'),
    ('libavfilter/dnn/dnn_backend_openvino.c', 'e75f22b2e2ee7f183f43f67e976568897929328643944f1e646bf5764bba0989'),
    ('libavfilter/dnn/dnn_backend_onnx.c', 'd3a5aa69bff8e53def65af955e7fd3aaf401b9370060e08ed295e4d7c322c4d4'),
    ('libavfilter/vf_dnn_processing.c', 'af23fbf4c7bf3b02d47dad2ab0d0f35d4c010ec9d60a060b6ff9941790244762'),
    ('libavfilter/vf_dnn_detect.c', '7bc89d613516763139bc5f918887f4560d1b754ba9a0267ab1cf3bd0573d4f5b'),
    ('libavfilter/vf_dnn_classify.c', 'c4a89d08aa82f7b960eb17927508d9b0c1f8e3b15eaa0914b30ccc7030a304dc'),
    ('libavfilter/vf_sr.c', 'e8b42a0a4c3d074f01fd9fcd2981cc0f378d7cb5f062a8bcae0538f02c451526'),
    ('libavfilter/vf_derain.c', '3c71042c508efb47f8e26b5abe20947b437401510874802cfcdecf685e7cd366'),
]:
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('DNN reader/child option grammar source drift: ' + path)
if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == 'libavfilter/dnn/dnn_interface.c'
           and r['table_kind'] == 'AVOption' and r['name'] == 'model' for r in rows):
    raise SystemExit('DNN model child option inventory drift')
for name in ['dnn_processing', 'dnn_detect', 'dnn_classify', 'sr', 'derain']:
    path = 'libavfilter/vf_' + name + '.c'
    fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
              and r['path'] == path and r['table_kind'] == 'AVOption'
              and r['type'] != 'AV_OPT_TYPE_CONST']
    keys = {'labels': True} if name in ['dnn_detect', 'dnn_classify'] else {}
    if not set(keys).issubset(fields):
        raise SystemExit('DNN labels option inventory drift: ' + path)
    filter_inputs[name] = {'positional': fields, 'keys': keys,
                          'lookups': ['model'], 'source': path}
# removelogo delegates to ff_load_image, which uses AVIO via image2pipe.
# Neither reader rewrites '-' to stdin. Adjacent filename/f offsets are aliases.
for path, digest in [
    ('libavfilter/vf_removelogo.c', 'f52985056e187e2601347c698c7100563aec0268205da7ac374201ed606316f5'),
    ('libavfilter/lavfutils.c', '4bc56cb5d3f909146ac262c864b41336139f4573003b775fd6de6c64b456fd5c'),
    ('libavfilter/src_movie.c', '9bbfec97618f61e5481cb227f00f00f4b076b5e61479a09a154da7a5ea2b4e44'),
]:
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('Filter AVIO reader source drift: ' + path)
bitmap_fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
                 and r['path'] == 'libavfilter/vf_removelogo.c'
                 and r['table_kind'] == 'AVOption' and r['type'] != 'AV_OPT_TYPE_CONST']
if bitmap_fields != ['filename', 'f']:
    raise SystemExit('removelogo bitmap option/alias inventory drift')
filter_inputs['removelogo'] = {'positional': ['filename'],
                              'keys': {field: False for field in bitmap_fields},
                              'source': 'libavfilter/vf_removelogo.c'}
# arnndn initializes/reloads its model through avpriv_fopen_utf8("r"), not
# AVIO. The adjacent model/m aliases share an offset in positional shorthand.
model_path = 'libavfilter/af_arnndn.c'
if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == model_path
           and r['sha256'] == '8d5653f74040c2c1044988ebde999850aef0b559ce6456518b9c9465cc702e2a'
           for r in source_files):
    raise SystemExit('arnndn model reader/reload grammar source drift')
model_fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
                and r['path'] == model_path and r['table_kind'] == 'AVOption'
                and r['type'] != 'AV_OPT_TYPE_CONST']
if model_fields != ['model', 'm', 'mix']:
    raise SystemExit('arnndn model option/alias inventory drift')
filter_inputs['arnndn'] = {'positional': [field for field in model_fields if field != 'm'],
                          'keys': {field: True for field in model_fields if field != 'mix'},
                          'source': model_path}
# Rectangle filters delegate bitmap reads to the registered ff_load_image AVIO
# reader. CONST entries (including cover_rect's duplicate "cover") are enum
# values, not shorthand fields. Mode/frame-dependent opens remain native reads.
for name, field, path, digest in [
    ('find_rect', 'object', 'libavfilter/vf_find_rect.c', '9de2002669874f32dfe132d922554d533c0da14bcd2e11a09a3a422060a3a4e5'),
    ('cover_rect', 'cover', 'libavfilter/vf_cover_rect.c', '9bdc1ad003a621fa6d1b9fa936900eaea9068263abf7b6304303df2beefa7816'),
]:
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('Rectangle bitmap reader grammar source drift: ' + path)
    fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
              and r['path'] == path and r['table_kind'] == 'AVOption'
              and r['type'] != 'AV_OPT_TYPE_CONST']
    if not fields or fields[0] != field or fields.count(field) != 1:
        raise SystemExit('Rectangle bitmap option inventory drift: ' + path)
    filter_inputs[name] = {'positional': fields, 'keys': {field: False}, 'source': path}
# sofalizer passes the selected filename to libmysofa's filesystem reader.
# This is not AVIO, a URL, a descriptor or a graph to tokenize again.
sofa_path = 'libavfilter/af_sofalizer.c'
if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == sofa_path
           and r['sha256'] == '3386922633040d16929a6e3f2875ffbc3aa168e9a4497d26f007f892b1de7272'
           for r in source_files):
    raise SystemExit('sofalizer SOFA reader grammar source drift')
sofa_fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
               and r['path'] == sofa_path and r['table_kind'] == 'AVOption'
               and r['type'] != 'AV_OPT_TYPE_CONST']
if not sofa_fields or sofa_fields[0] != 'sofa' or sofa_fields.count('sofa') != 1:
    raise SystemExit('sofalizer SOFA option inventory drift')
filter_inputs['sofalizer'] = {'positional': sofa_fields, 'keys': {'sofa': True},
                             'source': sofa_path}
# fsync_init opens the selected frame map through AVIO without rewriting '-'.
# file/f share the filename offset; native owns frame-map parsing and timing.
fsync_path = 'libavfilter/vf_fsync.c'
if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == fsync_path
           and r['sha256'] == 'c3fb2d0bf3316e89658bc7807c29e6f7ed22ff6886a3b757fe1792b92c877a54'
           for r in source_files):
    raise SystemExit('fsync frame-map AVIO reader grammar source drift')
fsync_fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
                and r['path'] == fsync_path and r['table_kind'] == 'AVOption'
                and r['type'] != 'AV_OPT_TYPE_CONST']
if fsync_fields != ['file', 'f']:
    raise SystemExit('fsync frame-map option/alias inventory drift')
filter_inputs['fsync'] = {'positional': [fsync_fields[0]],
                          'keys': {field: False for field in fsync_fields},
                          'source': fsync_path}
# showcqt reads axisfile with ff_load_image (AVIO), while FT_New_Face reads
# fontfile literally. Conditions and fallback selection require native runtime.
# The register lacks offsets: pin the implementation before skipping reviewed
# adjacent aliases for ff_filter_opt_parse positional shorthand.
showcqt_path = 'libavfilter/avf_showcqt.c'
if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == showcqt_path
           and r['sha256'] == '82692b6da0ebfbfe06fd131f88d665aad95c767c018f6f4893b631e8a6559fd5'
           for r in source_files):
    raise SystemExit('showcqt image/font reader grammar source drift')
showcqt_fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
                  and r['path'] == showcqt_path and r['table_kind'] == 'AVOption'
                  and r['type'] != 'AV_OPT_TYPE_CONST']
if not {'fontfile', 'axisfile'}.issubset(showcqt_fields):
    raise SystemExit('showcqt resource option inventory drift')
showcqt_aliases = {'s', 'rate', 'r', 'volume', 'volume2', 'gamma', 'gamma2', 'tc', 'text'}
filter_inputs['showcqt'] = {'positional': [field for field in showcqt_fields if field not in showcqt_aliases],
                            'keys': {'fontfile': True, 'axisfile': False}, 'source': showcqt_path}
# All assignments survive ff_filter_opt_parse's AV_DICT_MULTIKEY, and are
# applied before filter initialization. Slash assignments still load every
# value file; only the final value of an offset is used by initialization.
for path, digest in [
    ('libavfilter/avfilter.c', '27b56fafb1db7d75dc5e98ce14ce6a04471aa0583a2e1b3bee6cc43b06646915'),
    ('fftools/ffmpeg_filter.c', '85a5f5fec249430381d43ecbda28170ee6f4f2b86adfd5991c23cfeb1d57e273'),
    ('libavfilter/f_sendcmd.c', '3e16db7c16a59f2c654f452bd3e3060f9db9ced7bad458291ab9573d431c9849'),
    ('libavfilter/vf_psnr.c', '50a2eeffbe5cfc735a4dcf8a56cdd904e3d180c0db762b6edf225422a680db2c'),
    ('libavfilter/vf_ssim.c', '1946335f8417be92a0e858e359fb0c55cedd9e9159ef1409370db61ee240c49c'),
]:
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('Filter assignment/application grammar source drift: ' + path)
resource_aliases = {name: {'f': 'filename'} for name in ('subtitles', 'ass', 'removelogo', 'sendcmd', 'asendcmd')}
resource_aliases.update({name: {'f': 'stats_file'} for name in ('psnr', 'ssim')})
resource_aliases['arnndn'] = {'m': 'model'}
resource_aliases['fsync'] = {'f': 'file'}
for name, aliases in resource_aliases.items():
    metadata = filter_inputs.get(name) or filter_outputs.get(name)
    path = metadata['source'].split(':')[0] if metadata else 'libavfilter/f_sendcmd.c'
    fields = {field['name'] for field in macro['fields']} if path == macro['path'] else {
        r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
        and r['path'] == path and r['table_kind'] == 'AVOption'
        and r['type'] != 'AV_OPT_TYPE_CONST'}
    if not (set(aliases) | set(aliases.values())).issubset(fields):
        raise SystemExit('Filter resource alias inventory drift: ' + path)
# Both stabilization passes use literal avpriv_fopen_utf8 paths in config_input.
# Default names are implementation macros absent from the option register, so
# pin the complete implementations before deriving these reviewed values.
filter_defaults = {}
for name, field, access, digest in [
    ('vidstabdetect', 'result', 'write', '0c1fa31a677cbcf21ad91624cd35710e94550bdf09e6806c6a8c0e1ae651f139'),
    ('vidstabtransform', 'input', 'read', 'f085d5b55df26da08c1d3cbf24ef5a851d5ba908484cad06573429bec854e34f'),
]:
    path = 'libavfilter/vf_' + name + '.c'
    if not any(r['source_set'] == 'ffmpeg-release' and r['path'] == path
               and r['sha256'] == digest for r in source_files):
        raise SystemExit('Stabilization filename/default reader source drift: ' + path)
    fields = [r['name'] for r in rows if r['source_set'] == 'ffmpeg-release'
              and r['path'] == path and r['table_kind'] == 'AVOption'
              and r['type'] != 'AV_OPT_TYPE_CONST']
    if not fields or fields[0] != field:
        raise SystemExit('Stabilization positional filename inventory drift: ' + path)
    if access == 'write':
        filter_outputs[name] = {'keys': [field], 'positional': fields,
                                'literal': True, 'stdout': False, 'generated': False,
                                'source': path}
    else:
        filter_inputs[name] = {'positional': fields, 'keys': {field: True}, 'source': path}
    filter_defaults[name] = {field: 'transforms.trf'}
result += 'export const filterOutputMetadata = ' + json.dumps(filter_outputs, indent=2) + ' as const;\n'
result += 'export const filterInputMetadata = ' + json.dumps(filter_inputs, indent=2) + ' as const;\n'
result += 'export const filterResourceDefaults = ' + json.dumps(filter_defaults, indent=2) + ' as const;\n'
result += 'export const filterResourceAliases = ' + json.dumps(resource_aliases, indent=2) + ' as const;\n'
result += 'export const grammarRevision = "ffmpeg-9.0.1-register-v46";\n'
build = json.loads((PACKAGE / 'metadata/baselines/build-lock.json').read_text())
executables = {Path(path).name: {'path': path, 'sha256': entry['sha256']} for path, entry in build['binaries_and_dylibs'].items() if Path(path).name in ('ffmpeg', 'ffprobe')}
result += 'export const nativeReference = ' + json.dumps({'id': LOCK['registers']['packages/media-cli/metadata/baselines/build-lock.json'], 'platform': build['platform'], 'executables': executables}, indent=2) + ' as const;\n'
result += '''
// TypeScript readonly declarations do not protect the admitted runtime identity.
function freezeMetadata(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezeMetadata(child);
  }
}
freezeMetadata({ optionMetadata, avOptionNames, avCodecOptionNames,
  avCodecChildOptionNames, pathOptionMetadata, filterOutputMetadata,
  filterInputMetadata, filterResourceAliases, filterResourceDefaults, nativeReference });
'''
output = PACKAGE / 'src/options.generated.ts'
if '--check' in sys.argv:
    if not output.exists() or output.read_text() != result:
        raise SystemExit('Generated option metadata drift')
    print('Source registers and generated option metadata match the pin.')
else:
    output.write_text(result)
