export const playwrightHelpReference = `playwright-cli - run playwright mcp commands from terminal

Usage: playwright-cli <command> [args] [options]
Usage: playwright-cli -s=<session> <command> [args] [options]

Core:
  open [url]                  open the browser
  attach [name]               attach to a running playwright browser
  close                       close the browser
  detach                      detach from an attached browser
  goto <url>                  navigate to a url
  type <text>                 type text into editable element
  click <target> [button]     perform click on a web page
  dblclick <target> [button]  perform double click on a web page
  fill <target> <text>        fill text into editable element
  drag <startTarget> <endTarget> perform drag and drop between two elements
  drop <target>               drop files or data onto an element
  hover <target>              hover over element on page
  select <target> <val>       select an option in a dropdown
  upload <files...>           upload one or multiple files
  check <target>              check a checkbox or radio button
  uncheck <target>            uncheck a checkbox or radio button
  snapshot [target]           capture page snapshot to obtain element ref
  find [text]                 search the page snapshot for text or a regexp, returning matching nodes with surrounding context (like search snippets)
  eval <func> [target]        evaluate javascript expression on page or element
  dialog-accept [prompt]      accept a dialog
  dialog-dismiss              dismiss a dialog
  resize <w> <h>              resize the browser window
  delete-data                 delete session data

Navigation:
  go-back                     go back to the previous page
  go-forward                  go forward to the next page
  reload                      reload the current page

Keyboard:
  press <key>                 press a key on the keyboard, \`a\`, \`arrowleft\`
  keydown <key>               press a key down on the keyboard
  keyup <key>                 press a key up on the keyboard

Mouse:
  mousemove <x> <y>           move mouse to a given position
  mousedown [button]          press mouse down
  mouseup [button]            press mouse up
  mousewheel <dx> <dy>        scroll mouse wheel

Save as:
  screenshot [target]         screenshot of the current page or element
  pdf                         save page as pdf

Tabs:
  tab-list                    list all tabs
  tab-new [url]               create a new tab
  tab-close [index]           close a browser tab
  tab-select <index>          select a browser tab

Storage:
  state-load <filename>       loads browser storage (authentication) state from a file
  state-save [filename]       saves the current storage (authentication) state to a file
  cookie-list                 list all cookies (optionally filtered by domain/path)
  cookie-get <name>           get a specific cookie by name
  cookie-set <name> <value>   set a cookie with optional flags
  cookie-delete <name>        delete a specific cookie
  cookie-clear                clear all cookies
  localstorage-list           list all localstorage key-value pairs
  localstorage-get <key>      get a localstorage item by key
  localstorage-set <key> <value> set a localstorage item
  localstorage-delete <key>   delete a localstorage item
  localstorage-clear          clear all localstorage
  sessionstorage-list         list all sessionstorage key-value pairs
  sessionstorage-get <key>    get a sessionstorage item by key
  sessionstorage-set <key> <value> set a sessionstorage item
  sessionstorage-delete <key> delete a sessionstorage item
  sessionstorage-clear        clear all sessionstorage

Network:
  requests                    list all network requests since loading the page. each request is numbered for use with the \`request\` command.
  request <index>             show full details (headers, body, response) of a single network request by its number from the \`requests\` command.
  request-headers <index>     print only the request headers for a single network request by its number from the \`requests\` command.
  request-body <index>        print only the request body for a single network request by its number from the \`requests\` command.
  response-headers <index>    print only the response headers for a single network request by its number from the \`requests\` command.
  response-body <index>       print the response body for a single network request by its number from the \`requests\` command. textual bodies are inlined; binary bodies are saved to a file and the path is printed.
  route <pattern>             mock network requests matching a url pattern
  route-list                  list all active network routes
  unroute [pattern]           remove routes matching a pattern (or all routes)
  network-state-set <state>   set the browser network state to online or offline

DevTools:
  console [min-level]         list console messages
  run-code [code]             run playwright code snippet
  recording-start             start recording user actions
  recording-stop              stop recording user actions and print them as playwright code
  tracing-start               start trace recording
  tracing-stop                stop trace recording
  video-start [filename]      start video recording
  video-stop                  stop video recording
  video-chapter <title>       add a chapter marker to the video recording
  video-show-actions          annotate subsequent cli/mcp actions on the page with a callout that names the action and highlights the target element
  video-hide-actions          stop annotating actions performed on the page
  show                        show playwright dashboard
  pause-at <location>         run the test up to a specific location and pause there
  resume                      resume the test execution
  step-over                   step over the next call in the test
  generate-locator <target>   generate a playwright locator for the given element
  highlight [target]          show (or with --hide, remove) a highlight overlay for an element; \`--hide\` without a target hides all page highlights.

WebMCP:
  webmcp-list                 list the webmcp tools registered by the page
  webmcp-call <name>          call a webmcp tool registered by the page

Install:
  install                     initialize workspace
  install-browser [browser]   install browser

Browser sessions:
  list                        list browser sessions
  close-all                   close all browser sessions
  kill-all                    forcefully kill all browser sessions (for stale/zombie processes)

Global options:
  --help [command]            print help
  --json                      output response as JSON
  --raw                       output only the result value, without status and code
  --version                   print version
`;
