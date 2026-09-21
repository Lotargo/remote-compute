# remote-compute

`remote-compute` is a compact setup and compatibility layer that lets existing coding-agent harnesses use remote compute without replacing their planner, tool loop, permissions model, or provider CLI.

Current provider: **Google Colab through the official `colab` CLI**.

Supported agent hosts:

- Codex
- AGY / Antigravity CLI
- OpenCode
- Claude Code

The project is intentionally small. It installs a managed agent skill, prepares provider tooling, bridges Windows to WSL when needed, handles the official Colab OAuth2 flow, and then gets out of the way.

## Why

Coding agents are already capable of planning, delegating, retrying, inspecting files, running tests, and verifying results. Remote compute should be another capability available to that existing harness, not a second orchestration system.

`remote-compute` therefore follows a simple rule:

> keep planning in the host agent; keep provisioning and execution semantics in the official provider tooling.

Typical workloads include:

- GPU or CUDA probes;
- model training and inference;
- ComfyUI and rendering workloads;
- compilation and benchmarks;
- data processing;
- arbitrary Linux workloads that are impractical locally.

## Quick start

Install from npm:

```bash
npm install -g @lotargo/remote-compute
```

Before the npm release, or when testing the latest `main` directly from GitHub:

```bash
npm install -g github:Lotargo/remote-compute
```

Then run:

```bash
remote-compute setup
remote-compute auth
remote-compute doctor
```

A healthy installation ends with:

```text
Status: READY
```

For a first provider check:

```bash
remote-compute colab sessions
remote-compute colab skill
```

## How it works

```text
Codex / AGY / Claude Code / OpenCode
                 │
                 │ existing harness
                 ▼
        remote-compute skill
                 │
                 │ policy / workflow
                 ▼
      remote-compute colab
                 │
        ┌────────┴────────┐
        ▼                 ▼
 native colab          Windows
                         │
                         ▼
                        WSL
                         │
                         ▼
                   official colab
        └────────┬────────┘
                 ▼
          remote compute
```

The host agent remains responsible for planning, permissions, retries, delegation, tool use, and verification. The official provider CLI remains responsible for provider behavior. `remote-compute` only owns setup, policy, compatibility routing, and safe host integration.

There is no custom Colab API client and no second agent runtime.

## Agent host integration

The setup command detects supported agent CLIs on `PATH` and installs the bundled skill into their real skill directories.

```text
Codex
  ~/.codex/skills/remote-compute/
  ~/.agents/skills/remote-compute/

AGY / Antigravity
  ~/.gemini/config/skills/remote-compute/
  <workspace>/.agents/skills/remote-compute/   # when .agents already exists

OpenCode
  $OPENCODE_CONFIG_DIR/skills/remote-compute/
  or ~/.config/opencode/skills/remote-compute/

Claude Code
  ~/.claude/skills/remote-compute/
```

`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `OPENCODE_CONFIG_DIR` are respected where applicable.

At least one supported host is enough. You do not need every supported agent installed.

Skill installation is ownership-aware. `remote-compute` does not overwrite unrelated skill directories and does not silently delete modified managed skills.

## Windows without Docker

Windows remains the user's normal development environment. The repository, Codex, AGY, OpenCode, and Claude Code do not need to be moved into WSL.

When native `colab` is unavailable on Windows, `remote-compute` automatically uses WSL as a thin compatibility transport:

```text
PowerShell / Windows agent
          │
          ▼
    remote-compute
          │
          ▼
       wsl.exe
          │
          ▼
 official Linux Colab CLI
          │
          ▼
        Colab
```

No Docker runtime is required.

If WSL is missing, setup can request its installation explicitly:

```powershell
remote-compute setup --install-wsl --install-colab
```

A fresh WSL installation can require a Windows restart and one-time distro initialization. After that, rerun setup.

### WSL distro selection

By default, the Windows-configured default WSL distribution is used.

A specific installed distro can be selected without changing the global WSL default:

```powershell
remote-compute setup --wsl-distro Ubuntu --install-colab
remote-compute auth --wsl-distro Ubuntu
remote-compute doctor --wsl-distro Ubuntu
```

The same selection can be supplied through `REMOTE_COMPUTE_WSL_DISTRO`.

### Windows paths

Drive letters are never hardcoded.

`remote-compute` uses WSL's own path handling instead of assuming that `C:`, `F:`, `Z:`, or any other drive maps to `/mnt/<letter>`.

For explicit translation:

```powershell
remote-compute wsl-path "F:\projects\repo\model.bin"
```

The result comes from `wslpath` inside the selected distro, so custom WSL automount configuration is respected.

Mapped or network drives may legitimately be unavailable to WSL. That is reported as a compatibility condition instead of being hidden behind an invented path.

For provider commands, prefer relative paths when practical. The bridge starts provider execution from the current Windows working directory.

## Colab CLI bootstrap

`remote-compute setup --install-colab` installs the official `google-colab-cli` into the selected provider environment.

Installation prefers `uv`:

```text
uv tool install google-colab-cli
```

If `uv` is missing, `remote-compute` can bootstrap Astral's standalone `uv` installer into the provider user's `~/.local/bin`. Existing `pipx` is supported as a fallback.

The installer explicitly supplies the Google-maintained `jupyter-kernel-client` fork required by Colab CLI. This avoids resolving the incompatible same-named package from PyPI.

Modern Debian/Ubuntu environments may enforce PEP 668. `remote-compute` does not bypass that protection with `--break-system-packages`; it installs the CLI as an isolated user tool instead.

## Authentication

The managed default is the official Colab OAuth2 flow.

```bash
remote-compute auth
```

The CLI prints a Google authorization URL. Open it in any browser, sign in, and paste the returned authorization code back into the same terminal.

This works naturally for Windows + WSL because the browser does not need to run inside WSL.

`remote-compute` does not receive, proxy, print, or store Google credentials itself. Credential storage remains owned by the official Colab CLI.

Provider commands routed through `remote-compute colab ...` default to:

```text
--auth=oauth2
```

An explicit provider auth mode is preserved. For example:

```bash
remote-compute colab --auth=adc sessions
```

`gcloud` is therefore optional and only relevant when the user explicitly chooses an ADC-based workflow.

## Commands

### `remote-compute setup`

Detects agent hosts, installs or refreshes the managed skill, prepares the provider transport, and checks provider readiness.

```bash
remote-compute setup
remote-compute setup --install-colab
remote-compute setup --codex
remote-compute setup --agy --opencode
remote-compute setup --force
```

Windows-specific examples:

```powershell
remote-compute setup --install-wsl --install-colab
remote-compute setup --wsl-distro Ubuntu --install-colab
```

Host flags:

```text
--codex
--agy
--opencode
--claude
```

Without host flags, setup targets every supported host it detects.

`--force` refreshes an existing managed skill when it differs from the packaged copy. An unrelated skill with the same name is never overwritten.

### `remote-compute doctor`

Checks the real integration rather than only checking that files exist.

It validates:

- supported host discovery;
- managed skill state;
- native versus WSL provider transport;
- WSL distro selection;
- Colab CLI availability;
- OAuth2 access through a read-only sessions query;
- optional `gcloud` availability for explicit ADC workflows;
- platform compatibility.

```bash
remote-compute doctor
remote-compute doctor --codex
remote-compute doctor --wsl-distro Ubuntu
```

The report uses `OK`, `WARN`, `INFO`, and `FAIL`. Required failures produce a non-zero exit status.

### `remote-compute auth`

Runs the official Colab OAuth2 copy-paste login through the selected transport and verifies access afterwards.

```bash
remote-compute auth
remote-compute auth --wsl-distro Ubuntu
```

### `remote-compute colab`

Transparent passthrough to the official Colab CLI:

```bash
remote-compute colab skill
remote-compute colab sessions
remote-compute colab help
remote-compute colab help <command>
```

On Linux/macOS this uses native `colab`. On Windows it prefers native support when available and otherwise routes the same command through WSL.

### `remote-compute wsl-path`

Windows path diagnostic/translation helper:

```powershell
remote-compute wsl-path "Z:\work\artifact.bin"
```

No `/mnt/<drive>` convention is assumed by the package.

### `remote-compute uninstall`

Removes only unmodified skill directories owned by `remote-compute`.

```bash
remote-compute uninstall
remote-compute uninstall --codex
remote-compute uninstall --dry-run
```

Provider CLIs, WSL distributions, and Google credentials are left untouched.

### Version and help

```bash
remote-compute --version
remote-compute help
```

## Agent behavior

The bundled skill teaches policy rather than duplicating provider documentation.

Its main rules are:

- prefer local execution when local resources are sufficient;
- use remote compute only when it materially helps;
- use `remote-compute colab ...` as the platform-neutral provider gateway;
- query `colab skill` / `colab help` through the gateway instead of guessing provider flags;
- use exact Git revisions for reproducible jobs;
- never silently commit or push user changes;
- use disposable file transfer for small uncommitted experiments;
- keep large model weights, datasets, checkpoints, and generated assets out of Git;
- treat remote workers as disposable;
- persist important state externally;
- collect artifacts before teardown;
- stop unused paid or limited compute;
- never guess WSL drive mappings.

The agent should not reason about `wsl.exe`, `/mnt/f`, or distro internals during normal operation. Those deterministic platform decisions belong to `remote-compute`.

## Security and scope

`remote-compute` intentionally does **not** provide:

- a second agent harness;
- a custom Colab API client;
- credential storage;
- a Docker requirement;
- workload-specific runtime logic;
- model or dataset hosting;
- automatic Git commits or pushes;
- hardcoded Windows drive mappings;
- account rotation or quota circumvention.

It also does not automatically provision paid compute without an explicit user/provider action.

## Local development and verification

Runtime dependencies: **zero**.

Development baseline: **Node.js 18.18+**.

Install development dependencies:

```bash
npm install
```

Run the full local quality gate:

```bash
npm run verify
```

Platform wrappers run the same gate:

```bash
# Linux / macOS / WSL
sh scripts/verify.sh
```

```bat
:: Windows cmd.exe / PowerShell
scripts\verify.bat
```

The verification pipeline includes:

1. ESLint;
2. `node --check` syntax validation;
3. local unit/integration-style tests;
4. package, CLI, and skill contract tests;
5. native/Windows/WSL transport tests;
6. provider-gateway tests;
7. `C:`, `F:`, and `Z:` path delegation checks through `wslpath`;
8. `npm pack --dry-run` packaging validation.

Useful focused commands:

```bash
npm run lint
npm run lint:fix
npm run check
npm test
npm run test:contracts
npm run test:platform
npm run test:colab
npm run test:gateway
npm run test:wsl
npm run package:check
```

The tests use disposable HOME/workspace/PATH environments and fake provider/agent CLIs where possible, so they do not mutate the developer's real agent configuration.

## Validation status

The v0.1.0 flow has been validated end-to-end on Windows using the real compatibility path:

```text
PowerShell
   ↓
remote-compute
   ↓
WSL
   ↓
google-colab-cli
   ↓
OAuth2
   ↓
Google Colab
```

The real `remote-compute doctor` path reaches `Status: READY`, and `remote-compute colab sessions` succeeds through the bridge.

Linux and macOS use the native transport and remain part of the local cross-platform contract suite; additional real-host testing is welcome as the project moves beyond the first release.

## Architecture

```text
src/
├── cli.mjs                command routing and UX
├── client_cli.mjs         cross-platform executable discovery and CLI launching
├── client_paths.mjs       host path resolution / XDG handling
├── hosts.mjs              supported host definitions and skill targets
├── skills.mjs             ownership-safe skill install/remove
├── colab.mjs              provider bootstrap/auth/passthrough
└── transports/
    ├── native.mjs         native provider execution
    └── wsl.mjs            Windows -> WSL compatibility bridge
```

The host-integration layer follows patterns already proven in `Lotargo/memory_plugin`: centralized client paths, Windows npm-shim handling, host-specific targets, ownership-aware cleanup, native tooling first, and temporary-environment tests.

## Release history

See [CHANGELOG.md](./CHANGELOG.md).

## Roadmap

The agent-facing policy is intentionally provider-neutral even though Google Colab is the first provider.

Possible future adapters may include SSH workers, RunPod, Vast.ai, or GCP without changing the agent-facing mental model.

The design rule remains simple: only add deterministic helpers when real usage proves that the official provider tooling plus the skill is not reliable enough.

## Status

**v0.1.0 release candidate.** The Windows + WSL + Colab path is working end-to-end, the local verification gate is green, and the next phase is real-world usage and edge-case collection rather than additional architecture for its own sake.
