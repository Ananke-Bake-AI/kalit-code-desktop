# kalit-code-desktop

A simple **ChatGPT-style desktop app** (Electron) for the kalit-code agent. Same
engine as [`kalit-code-cli`](../kalit-code-cli) — both import the shared
[`kalit-code-core`](../kalit-code-core) — so there is **no duplicated agent code**.

The agent runs in the Electron **main process** with full Node / filesystem /
shell access (this is the point); the window is a sandboxed renderer that only
talks to it over IPC.

```
kalit-code-desktop (UI)              kalit-code-cli (terminal)
        │                                     │
        └──────────► kalit-code-core ◄─────────┘   (runTurn, events, models)
                          │
                          ▼  ANTHROPIC_BASE_URL
                  kalit-model-server  ──►  Ollama / Kimi / …
```

## Prerequisites

A running [`kalit-model-server`](../kalit-model-server):

```bash
cd ../kalit-model-server && npm start
```

## Run

```bash
cd kalit-code-desktop
npm install        # links ../kalit-code-core via file: dependency
npm start          # builds (tsc) then launches Electron
```

## Features (v1, intentionally simple)

- ChatGPT-style streaming chat (text + collapsible **thinking** + tool-call pills)
- **Context ring** by the prompt: % of context used before Claude Code auto-compacts
- **Settings** (gear): model server URL, token, model (dropdown from `/v1/models`),
  working directory, autonomy level (`bypassPermissions` … `plan`), context window
- New-conversation / Stop buttons
- Config persisted to the app's userData dir

> ⚠️ Default autonomy is `bypassPermissions` — the agent edits files and runs
> shell commands in the configured working directory without asking. Set it to
> `plan` in Settings if you want it to propose first.
