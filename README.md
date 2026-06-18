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
> shell commands in the working directory without asking. (Working dir / autonomy
> default sensibly and aren't in the simplified Settings panel; override via the
> persisted `config.json` or `KALIT_CWD` / `KALIT_PERMISSION_MODE` env vars.)

## Build & release

Local package (macOS):

```bash
npm install --install-links     # real copy of ../kalit-code-core (asar-safe)
npm run dist:mac                # → release/*.dmg + *.zip
```

Cross-platform release is automated. Pushing a tag builds macOS **and** Windows
on GitHub Actions and publishes a GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow (`.github/workflows/release.yml`) checks out `kalit-code-core` as a
sibling so the `file:` dependency resolves on the runners. If that repo is
**private**, add a repo-scoped PAT as the `CORE_TOKEN` Actions secret. Builds are
**unsigned** (Gatekeeper/SmartScreen will warn on first launch).

