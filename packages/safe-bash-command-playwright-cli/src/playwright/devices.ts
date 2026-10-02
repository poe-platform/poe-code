/*! @license
This package includes material from Microsoft Playwright, Copyright (c)
Microsoft Corporation, licensed under the Apache License, Version 2.0.
The complete license text follows this notice.

The compatibility reference is @playwright/cli 0.1.20, including its bundled
playwright-core 1.64.0-alpha-2026-09-14:

- Device descriptors: packages/playwright-core/src/server/deviceDescriptorsSource.json.
- Locator parsing and selector escaping: packages/isomorphic/locatorParser.ts,
  locatorUtils.ts, and stringUtils.ts. Adapted for standalone typed parsing;
  native locator round-trip validation is applied by this package.
- Standard CLI workspace skill content, help text, and command descriptions.

Upstream source: https://github.com/microsoft/playwright

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Portions Copyright (c) Microsoft Corporation.
   Portions Copyright 2017 Google Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).

*/
/*
 * Copyright (c) Microsoft Corporation.
 * SPDX-License-Identifier: Apache-2.0
 * Canonical device descriptors from playwright-core@1.64.0-alpha-2026-09-14,
 * as bundled by @playwright/cli@0.1.20. Provider overrides take precedence.
 * Source: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json
 * Apache-2.0 license and upstream notice reproduced in third-party/playwright/LICENSE.
 */
import type { PlaywrightDeviceDescriptor } from './adapter.js';

export const canonicalPlaywrightDevices: Readonly<Record<string, PlaywrightDeviceDescriptor>> = {
  "Blackberry PlayBook": {
    "userAgent": "Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/26.6 Safari/536.2+",
    "viewport": {
      "width": 600,
      "height": 1024
    },
    "deviceScaleFactor": 1,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Blackberry PlayBook landscape": {
    "userAgent": "Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/26.6 Safari/536.2+",
    "viewport": {
      "width": 1024,
      "height": 600
    },
    "deviceScaleFactor": 1,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "BlackBerry Z30": {
    "userAgent": "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.10+ (KHTML, like Gecko) Version/26.6 Mobile Safari/537.10+",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "BlackBerry Z30 landscape": {
    "userAgent": "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.10+ (KHTML, like Gecko) Version/26.6 Mobile Safari/537.10+",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Galaxy Note 3": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.3; en-us; SM-N900T Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.6 Mobile Safari/534.30",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Galaxy Note 3 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.3; en-us; SM-N900T Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.6 Mobile Safari/534.30",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Galaxy Note II": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.1; en-us; GT-N7100 Build/JRO03C) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.6 Mobile Safari/534.30",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Galaxy Note II landscape": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.1; en-us; GT-N7100 Build/JRO03C) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.6 Mobile Safari/534.30",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Galaxy S III": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.0; en-us; GT-I9300 Build/IMM76D) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.6 Mobile Safari/534.30",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Galaxy S III landscape": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.0; en-us; GT-I9300 Build/IMM76D) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.6 Mobile Safari/534.30",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Galaxy S5": {
    "userAgent": "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy S5 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy S8": {
    "userAgent": "Mozilla/5.0 (Linux; Android 7.0; SM-G950U Build/NRD90M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 740
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy S8 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 7.0; SM-G950U Build/NRD90M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 740,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy S9+": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; SM-G965U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 320,
      "height": 658
    },
    "deviceScaleFactor": 4.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy S9+ landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; SM-G965U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 658,
      "height": 320
    },
    "deviceScaleFactor": 4.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy S24": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 780
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy S24 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 780,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy A55": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 480,
      "height": 1040
    },
    "deviceScaleFactor": 2.25,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy A55 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 1040,
      "height": 480
    },
    "deviceScaleFactor": 2.25,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Tab S4": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.1.0; SM-T837A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 712,
      "height": 1138
    },
    "deviceScaleFactor": 2.25,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Tab S4 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.1.0; SM-T837A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 1138,
      "height": 712
    },
    "deviceScaleFactor": 2.25,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Tab S9": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 640,
      "height": 1024
    },
    "deviceScaleFactor": 2.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Tab S9 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 1024,
      "height": 640
    },
    "deviceScaleFactor": 2.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 6": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F956U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 928,
      "height": 1004
    },
    "screen": {
      "width": 928,
      "height": 1080
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 6 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F956U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 1028,
      "height": 876
    },
    "screen": {
      "width": 1080,
      "height": 928
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 6 Cover": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F956U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 484,
      "height": 1112
    },
    "screen": {
      "width": 484,
      "height": 1188
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 6 Cover landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F956U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 1136,
      "height": 432
    },
    "screen": {
      "width": 1188,
      "height": 484
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 7": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F966U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 984,
      "height": 1016
    },
    "screen": {
      "width": 984,
      "height": 1092
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 7 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F966U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 1040,
      "height": 932
    },
    "screen": {
      "width": 1092,
      "height": 984
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 7 Cover": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F966U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 764
    },
    "screen": {
      "width": 360,
      "height": 840
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Fold 7 Cover landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F966U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 788,
      "height": 308
    },
    "screen": {
      "width": 840,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 6": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F741U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 804
    },
    "screen": {
      "width": 360,
      "height": 880
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 6 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F741U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 828,
      "height": 308
    },
    "screen": {
      "width": 880,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 6 Cover": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F741U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 298
    },
    "screen": {
      "width": 360,
      "height": 374
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 6 Cover landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F741U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 322,
      "height": 308
    },
    "screen": {
      "width": 374,
      "height": 360
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 7": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F761U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 764
    },
    "screen": {
      "width": 360,
      "height": 840
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 7 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F761U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 788,
      "height": 308
    },
    "screen": {
      "width": 840,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 7 Cover": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F761U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 474,
      "height": 448
    },
    "screen": {
      "width": 474,
      "height": 524
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Galaxy Z Flip 7 Cover landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; SM-F761U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 472,
      "height": 422
    },
    "screen": {
      "width": 524,
      "height": 474
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "iPad (gen 5)": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 768,
      "height": 1024
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad (gen 5) landscape": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 1024,
      "height": 768
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad (gen 6)": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 768,
      "height": 1024
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad (gen 6) landscape": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 1024,
      "height": 768
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad (gen 7)": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 810,
      "height": 1080
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad (gen 7) landscape": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 1080,
      "height": 810
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad (gen 11)": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/19E241 Safari/604.1",
    "viewport": {
      "width": 656,
      "height": 944
    },
    "deviceScaleFactor": 2.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad (gen 11) landscape": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/19E241 Safari/604.1",
    "viewport": {
      "width": 944,
      "height": 656
    },
    "deviceScaleFactor": 2.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad Mini": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 768,
      "height": 1024
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad Mini landscape": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 1024,
      "height": 768
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad Pro 11": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 834,
      "height": 1194
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPad Pro 11 landscape": {
    "userAgent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 1194,
      "height": 834
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 6": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 375,
      "height": 667
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 6 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 667,
      "height": 375
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 6 Plus": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 414,
      "height": 736
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 6 Plus landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 736,
      "height": 414
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 7": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 375,
      "height": 667
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 7 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 667,
      "height": 375
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 7 Plus": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 414,
      "height": 736
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 7 Plus landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 736,
      "height": 414
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 8": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 375,
      "height": 667
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 8 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 667,
      "height": 375
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 8 Plus": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 414,
      "height": 736
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 8 Plus landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 736,
      "height": 414
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone SE": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/26.6 Mobile/14E304 Safari/602.1",
    "viewport": {
      "width": 320,
      "height": 568
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone SE landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/26.6 Mobile/14E304 Safari/602.1",
    "viewport": {
      "width": 568,
      "height": 320
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone SE (3rd gen)": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/26.6 Mobile/19E241 Safari/602.1",
    "viewport": {
      "width": 375,
      "height": 667
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone SE (3rd gen) landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/26.6 Mobile/19E241 Safari/602.1",
    "viewport": {
      "width": 667,
      "height": 375
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone X": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 375,
      "height": 812
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone X landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.6 Mobile/15A372 Safari/604.1",
    "viewport": {
      "width": 812,
      "height": 375
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone XR": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 414,
      "height": 896
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone XR landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 896,
      "height": 414
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 11": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 414,
      "height": 715
    },
    "screen": {
      "width": 414,
      "height": 896
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 11 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 800,
      "height": 364
    },
    "screen": {
      "width": 414,
      "height": 896
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 11 Pro": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 375,
      "height": 635
    },
    "screen": {
      "width": 375,
      "height": 812
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 11 Pro landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 724,
      "height": 325
    },
    "screen": {
      "width": 375,
      "height": 812
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 11 Pro Max": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 414,
      "height": 715
    },
    "screen": {
      "width": 414,
      "height": 896
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 11 Pro Max landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 808,
      "height": 364
    },
    "screen": {
      "width": 414,
      "height": 896
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 390,
      "height": 664
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 750,
      "height": 340
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12 Pro": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 390,
      "height": 664
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12 Pro landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 750,
      "height": 340
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12 Pro Max": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 428,
      "height": 746
    },
    "screen": {
      "width": 428,
      "height": 926
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12 Pro Max landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 832,
      "height": 378
    },
    "screen": {
      "width": 428,
      "height": 926
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12 Mini": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 375,
      "height": 629
    },
    "screen": {
      "width": 375,
      "height": 812
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 12 Mini landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 712,
      "height": 325
    },
    "screen": {
      "width": 375,
      "height": 812
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 390,
      "height": 664
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 750,
      "height": 342
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13 Pro": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 390,
      "height": 664
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13 Pro landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 750,
      "height": 342
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13 Pro Max": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 428,
      "height": 746
    },
    "screen": {
      "width": 428,
      "height": 926
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13 Pro Max landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 832,
      "height": 380
    },
    "screen": {
      "width": 428,
      "height": 926
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13 Mini": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 375,
      "height": 629
    },
    "screen": {
      "width": 375,
      "height": 812
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 13 Mini landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 712,
      "height": 327
    },
    "screen": {
      "width": 375,
      "height": 812
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 390,
      "height": 664
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 750,
      "height": 340
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14 Plus": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 428,
      "height": 746
    },
    "screen": {
      "width": 428,
      "height": 926
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14 Plus landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 832,
      "height": 378
    },
    "screen": {
      "width": 428,
      "height": 926
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14 Pro": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 393,
      "height": 660
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14 Pro landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 734,
      "height": 343
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14 Pro Max": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 430,
      "height": 740
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 14 Pro Max landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 814,
      "height": 380
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 393,
      "height": 659
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 734,
      "height": 343
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15 Plus": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 430,
      "height": 739
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15 Plus landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 814,
      "height": 380
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15 Pro": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 393,
      "height": 659
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15 Pro landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 734,
      "height": 343
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15 Pro Max": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 430,
      "height": 739
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 15 Pro Max landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 814,
      "height": 380
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 393,
      "height": 659
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 734,
      "height": 343
    },
    "screen": {
      "width": 393,
      "height": 852
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16 Plus": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 430,
      "height": 739
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16 Plus landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 814,
      "height": 380
    },
    "screen": {
      "width": 430,
      "height": 932
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16 Pro": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 402,
      "height": 681
    },
    "screen": {
      "width": 402,
      "height": 874
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16 Pro landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 756,
      "height": 352
    },
    "screen": {
      "width": 402,
      "height": 874
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16 Pro Max": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 440,
      "height": 763
    },
    "screen": {
      "width": 440,
      "height": 956
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16 Pro Max landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 838,
      "height": 390
    },
    "screen": {
      "width": 440,
      "height": 956
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16e": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 390,
      "height": 651
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 16e landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 726,
      "height": 340
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 402,
      "height": 681
    },
    "screen": {
      "width": 402,
      "height": 874
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17 landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 756,
      "height": 352
    },
    "screen": {
      "width": 402,
      "height": 874
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone Air": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 420,
      "height": 719
    },
    "screen": {
      "width": 420,
      "height": 912
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone Air landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 794,
      "height": 370
    },
    "screen": {
      "width": 420,
      "height": 912
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17 Pro": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 402,
      "height": 681
    },
    "screen": {
      "width": 402,
      "height": 874
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17 Pro landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 756,
      "height": 352
    },
    "screen": {
      "width": 402,
      "height": 874
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17 Pro Max": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 440,
      "height": 763
    },
    "screen": {
      "width": 440,
      "height": 956
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17 Pro Max landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 838,
      "height": 390
    },
    "screen": {
      "width": 440,
      "height": 956
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17e": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 390,
      "height": 651
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "iPhone 17e landscape": {
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
    "viewport": {
      "width": 726,
      "height": 340
    },
    "screen": {
      "width": 390,
      "height": 844
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Kindle Fire HDX": {
    "userAgent": "Mozilla/5.0 (Linux; U; en-us; KFAPWI Build/JDQ39) AppleWebKit/535.19 (KHTML, like Gecko) Silk/3.13 Safari/535.19 Silk-Accelerated=true",
    "viewport": {
      "width": 800,
      "height": 1280
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Kindle Fire HDX landscape": {
    "userAgent": "Mozilla/5.0 (Linux; U; en-us; KFAPWI Build/JDQ39) AppleWebKit/535.19 (KHTML, like Gecko) Silk/3.13 Safari/535.19 Silk-Accelerated=true",
    "viewport": {
      "width": 1280,
      "height": 800
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "LG Optimus L70": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; LGMS323 Build/KOT49I.MS32310c) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 384,
      "height": 640
    },
    "deviceScaleFactor": 1.25,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "LG Optimus L70 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; LGMS323 Build/KOT49I.MS32310c) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 640,
      "height": 384
    },
    "deviceScaleFactor": 1.25,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Microsoft Lumia 550": {
    "userAgent": "Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 550) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36 Edge/14.14263",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Microsoft Lumia 550 landscape": {
    "userAgent": "Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 550) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36 Edge/14.14263",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Microsoft Lumia 950": {
    "userAgent": "Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36 Edge/14.14263",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 4,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Microsoft Lumia 950 landscape": {
    "userAgent": "Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36 Edge/14.14263",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 4,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 10": {
    "userAgent": "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 10 Build/MOB31T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 800,
      "height": 1280
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 10 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 10 Build/MOB31T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 1280,
      "height": 800
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 4": {
    "userAgent": "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 4 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 384,
      "height": 640
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 4 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 4 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 640,
      "height": 384
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 5": {
    "userAgent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 5 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 5X": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; Nexus 5X Build/OPR4.170623.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 732
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 5X landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; Nexus 5X Build/OPR4.170623.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 732,
      "height": 412
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 6": {
    "userAgent": "Mozilla/5.0 (Linux; Android 7.1.1; Nexus 6 Build/N6F26U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 732
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 6 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 7.1.1; Nexus 6 Build/N6F26U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 732,
      "height": 412
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 6P": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; Nexus 6P Build/OPP3.170518.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 732
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 6P landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; Nexus 6P Build/OPP3.170518.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 732,
      "height": 412
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 7": {
    "userAgent": "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 7 Build/MOB30X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 600,
      "height": 960
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nexus 7 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 7 Build/MOB30X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 960,
      "height": 600
    },
    "deviceScaleFactor": 2,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nokia Lumia 520": {
    "userAgent": "Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 520)",
    "viewport": {
      "width": 320,
      "height": 533
    },
    "deviceScaleFactor": 1.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nokia Lumia 520 landscape": {
    "userAgent": "Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 520)",
    "viewport": {
      "width": 533,
      "height": 320
    },
    "deviceScaleFactor": 1.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Nokia N9": {
    "userAgent": "Mozilla/5.0 (MeeGo; NokiaN9) AppleWebKit/534.13 (KHTML, like Gecko) NokiaBrowser/8.5.0 Mobile Safari/534.13",
    "viewport": {
      "width": 480,
      "height": 854
    },
    "deviceScaleFactor": 1,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Nokia N9 landscape": {
    "userAgent": "Mozilla/5.0 (MeeGo; NokiaN9) AppleWebKit/534.13 (KHTML, like Gecko) NokiaBrowser/8.5.0 Mobile Safari/534.13",
    "viewport": {
      "width": 854,
      "height": 480
    },
    "deviceScaleFactor": 1,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "webkit"
  },
  "Pixel 2": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 411,
      "height": 731
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 2 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 731,
      "height": 411
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 2 XL": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; Pixel 2 XL Build/OPD1.170816.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 411,
      "height": 823
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 2 XL landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 8.0.0; Pixel 2 XL Build/OPD1.170816.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 823,
      "height": 411
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 3": {
    "userAgent": "Mozilla/5.0 (Linux; Android 9; Pixel 3 Build/PQ1A.181105.017.A1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 393,
      "height": 786
    },
    "deviceScaleFactor": 2.75,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 3 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 9; Pixel 3 Build/PQ1A.181105.017.A1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 786,
      "height": 393
    },
    "deviceScaleFactor": 2.75,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 4": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 353,
      "height": 745
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 4 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 745,
      "height": 353
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 4a (5G)": {
    "userAgent": "Mozilla/5.0 (Linux; Android 11; Pixel 4a (5G)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 765
    },
    "screen": {
      "width": 412,
      "height": 892
    },
    "deviceScaleFactor": 2.63,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 4a (5G) landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 11; Pixel 4a (5G)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 840,
      "height": 312
    },
    "screen": {
      "width": 412,
      "height": 892
    },
    "deviceScaleFactor": 2.63,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 5": {
    "userAgent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 393,
      "height": 727
    },
    "screen": {
      "width": 393,
      "height": 851
    },
    "deviceScaleFactor": 2.75,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 5 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 802,
      "height": 293
    },
    "screen": {
      "width": 851,
      "height": 393
    },
    "deviceScaleFactor": 2.75,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 6": {
    "userAgent": "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 839
    },
    "screen": {
      "width": 412,
      "height": 915
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 6 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 863,
      "height": 360
    },
    "screen": {
      "width": 915,
      "height": 412
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 6 Pro": {
    "userAgent": "Mozilla/5.0 (Linux; Android 12; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 816
    },
    "screen": {
      "width": 412,
      "height": 892
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 6 Pro landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 12; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 840,
      "height": 360
    },
    "screen": {
      "width": 892,
      "height": 412
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 6a": {
    "userAgent": "Mozilla/5.0 (Linux; Android 12; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 839
    },
    "screen": {
      "width": 412,
      "height": 915
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 6a landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 12; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 863,
      "height": 360
    },
    "screen": {
      "width": 915,
      "height": 412
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 7": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 839
    },
    "screen": {
      "width": 412,
      "height": 915
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 7 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 863,
      "height": 360
    },
    "screen": {
      "width": 915,
      "height": 412
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 7 Pro": {
    "userAgent": "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 816
    },
    "screen": {
      "width": 412,
      "height": 892
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 7 Pro landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 840,
      "height": 360
    },
    "screen": {
      "width": 892,
      "height": 412
    },
    "deviceScaleFactor": 3.5,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 7a": {
    "userAgent": "Mozilla/5.0 (Linux; Android 13; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 839
    },
    "screen": {
      "width": 412,
      "height": 915
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 7a landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 13; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 863,
      "height": 360
    },
    "screen": {
      "width": 915,
      "height": 412
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 8": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 839
    },
    "screen": {
      "width": 412,
      "height": 915
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 8 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 863,
      "height": 360
    },
    "screen": {
      "width": 915,
      "height": 412
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 8 Pro": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 448,
      "height": 921
    },
    "screen": {
      "width": 448,
      "height": 997
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 8 Pro landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 945,
      "height": 396
    },
    "screen": {
      "width": 997,
      "height": 448
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 8a": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 8a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 412,
      "height": 839
    },
    "screen": {
      "width": 412,
      "height": 915
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 8a landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 8a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 863,
      "height": 360
    },
    "screen": {
      "width": 915,
      "height": 412
    },
    "deviceScaleFactor": 2.625,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 9": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 732
    },
    "screen": {
      "width": 360,
      "height": 808
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 9 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 756,
      "height": 308
    },
    "screen": {
      "width": 808,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 9 Pro": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 427,
      "height": 876
    },
    "screen": {
      "width": 427,
      "height": 952
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 9 Pro landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 900,
      "height": 375
    },
    "screen": {
      "width": 952,
      "height": 427
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 9 Pro XL": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 448,
      "height": 921
    },
    "screen": {
      "width": 448,
      "height": 997
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 9 Pro XL landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 945,
      "height": 396
    },
    "screen": {
      "width": 997,
      "height": 448
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 10": {
    "userAgent": "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 732
    },
    "screen": {
      "width": 360,
      "height": 808
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 10 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 756,
      "height": 308
    },
    "screen": {
      "width": 808,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 10 Pro": {
    "userAgent": "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 427,
      "height": 876
    },
    "screen": {
      "width": 427,
      "height": 952
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 10 Pro landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 900,
      "height": 375
    },
    "screen": {
      "width": 952,
      "height": 427
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 10 Pro XL": {
    "userAgent": "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 448,
      "height": 921
    },
    "screen": {
      "width": 448,
      "height": 997
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Pixel 10 Pro XL landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 945,
      "height": 396
    },
    "screen": {
      "width": 997,
      "height": 448
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Moto G4": {
    "userAgent": "Mozilla/5.0 (Linux; Android 7.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 360,
      "height": 640
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Moto G4 landscape": {
    "userAgent": "Mozilla/5.0 (Linux; Android 7.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Mobile Safari/537.36",
    "viewport": {
      "width": 640,
      "height": 360
    },
    "deviceScaleFactor": 3,
    "isMobile": true,
    "hasTouch": true,
    "defaultBrowserType": "chromium"
  },
  "Desktop Chrome HiDPI": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "screen": {
      "width": 1792,
      "height": 1120
    },
    "deviceScaleFactor": 2,
    "isMobile": false,
    "hasTouch": false,
    "defaultBrowserType": "chromium"
  },
  "Desktop Edge HiDPI": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36 Edg/154.0.8037.0",
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "screen": {
      "width": 1792,
      "height": 1120
    },
    "deviceScaleFactor": 2,
    "isMobile": false,
    "hasTouch": false,
    "defaultBrowserType": "chromium"
  },
  "Desktop Firefox HiDPI": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0",
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "screen": {
      "width": 1792,
      "height": 1120
    },
    "deviceScaleFactor": 2,
    "isMobile": false,
    "hasTouch": false,
    "defaultBrowserType": "firefox"
  },
  "Desktop Safari": {
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15",
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "screen": {
      "width": 1792,
      "height": 1120
    },
    "deviceScaleFactor": 2,
    "isMobile": false,
    "hasTouch": false,
    "defaultBrowserType": "webkit"
  },
  "Desktop Chrome": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36",
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "screen": {
      "width": 1920,
      "height": 1080
    },
    "deviceScaleFactor": 1,
    "isMobile": false,
    "hasTouch": false,
    "defaultBrowserType": "chromium"
  },
  "Desktop Edge": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.0 Safari/537.36 Edg/154.0.8037.0",
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "screen": {
      "width": 1920,
      "height": 1080
    },
    "deviceScaleFactor": 1,
    "isMobile": false,
    "hasTouch": false,
    "defaultBrowserType": "chromium"
  },
  "Desktop Firefox": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0",
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "screen": {
      "width": 1920,
      "height": 1080
    },
    "deviceScaleFactor": 1,
    "isMobile": false,
    "hasTouch": false,
    "defaultBrowserType": "firefox"
  }
};
