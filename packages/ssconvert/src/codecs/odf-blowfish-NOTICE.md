The Blowfish primitive and pi initialization words in odf-blowfish.ts and
odf-blowfish-profile.ts are adapted from egoroof-blowfish 4.0.3,
https://github.com/egoroof/blowfish (published MIT source).

The adaptation implements only the ODF 8-bit CFB reader path, removes temporary
key expansion copies, adds per-key-pair/per-byte cancellation and scheduler
yields, and wipes owned key schedules and failed plaintext. The standard 16-round
primitive and all 1042 initialization words are unchanged. AES and ODF package
admission/derivation/checksum/framing are separate implementations.

The MIT License (MIT)

Copyright @egoroof

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

