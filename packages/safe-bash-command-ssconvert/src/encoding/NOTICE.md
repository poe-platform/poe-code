The product never invokes iconv or reads host locale/converter data. The static
single-byte and alias data was measured from the separately pinned glibc 2.41 QA
oracle. ASCII transliteration was measured for every Unicode scalar under C and
C.UTF-8. Per-target scalar mappings were also captured for each of the 44
single-byte codepages. These observations do not establish context-sensitive
transliteration parity for arbitrary sequences or other encodings.
UCS-2 replacements were additionally captured for every supplementary Unicode
scalar in both locales; its C.UTF-8 sparse data retains representable BMP text.

Conservatively, the generated data is distributed under LGPL-2.1-or-later, with
the included LGPL-2.1 text. GNU libc and its converter/locale configuration are
Copyright Free Software Foundation, Inc. No GNU libc executable code is included.
The handwritten runtime remains under the package's GPL-2.0-or-later license.
See the encoding QA procedure and verification document for measured scope and
remaining gaps. No third-party JavaScript runtime library is required.
