# Script manifest format

Each `manifests/<id>.json` describes one launchable script in this repo so a web UI
(e.g. ServisesVI) can build a form and run it as a child process without knowing
anything about the script's internals. The UI should list `manifests/index.json`,
then load each file.

```jsonc
{
  "id": "parser_request",               // stable key, used by the UI/backend
  "name": "Wordstat Parser (Yandex)",   // display name
  "description": "...",                 // one sentence, shown in the UI
  "cwd": "Parser_request",              // folder to spawn the process in (relative to repo root)
  "command": "node",
  "args": ["index.js"],                 // argv after command; UI-filled params get appended/injected per "inputs"
  "install": {                          // whether `cwd` needs its own `npm install` before first run
    "needed": true,
    "command": "npm install"
  },
  "inputs": [                           // files or values the UI must let the user edit/upload before running
    {
      "key": "queries",
      "label": "Запросы (по одному на строку)",
      "kind": "file",                   // "file" | "text" | "select" | "flag" | "date"
      "path": "requests.txt",           // relative to cwd, when kind == "file"
      "required": true
    },
    {
      "key": "cookies",
      "label": "Cookies site.com (JSON)",
      "kind": "file",
      "path": "cookies.json",
      "required": false,
      "cookieKey": "site.com"           // optional, only on kind=="file" inputs that hold login
                                         // cookies: a shared key identifying which site's cookies
                                         // this is. The UI stores one value per cookieKey globally
                                         // (not per script) and reuses it across every manifest that
                                         // declares the same cookieKey, instead of asking to re-paste
                                         // cookies for each script separately.
    }
  ],
  "env": [                              // required process.env keys, and which .env file they come from
    { "name": "YANDEX_LOGIN", "required": true, "file": ".env" }
  ],
  "outputs": [                          // where results land, so the UI can offer a download/preview
    { "path": "Results/WordStat.csv", "kind": "csv", "description": "..." }
  ],
  "execution": {
    "headless": false,                  // false = opens a visible Chrome window (only meaningful if backend has a display / xvfb)
    "interactive": false,               // script reads menu choices from stdin before running
    "blocking": [],                     // known stdin/manual gates the UI must handle, see enum below
    "resumable": false                  // safe to re-run after a crash/kill without losing progress
  },
  "knownIssues": []                     // bugs/inconsistencies found while writing this manifest - fix before wiring to the UI
}
```

`execution.blocking` enum (what the UI needs a "waiting for you" affordance for):
- `"manual-captcha"` – script pauses and waits for Enter in its stdin after you solve a captcha in the visible browser
- `"manual-login"` – script waits for you to log in by hand in the visible browser, then press Enter
- `"notepad-edit"` – script shells out to `notepad.exe` and blocks until that window is closed (Windows-only; breaks on a headless VDS)
- `"interactive-menu"` – script reads numbered menu choices / y-n prompts from stdin before starting work

None of the scripts' own code was modified while writing these manifests — only the issues below were catalogued.
