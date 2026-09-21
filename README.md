# remote-compute

A compact setup layer that teaches existing coding-agent harnesses how to use remote compute without replacing their planner, tool loop, or provider CLIs.

`remote-compute` is intentionally **not** another agent runtime. It detects supported agent hosts, installs a provider-neutral skill into the host's real skill directories, checks the provider tooling, helps launch the official authentication flow, and then gets out of the execution path.

Current provider: **Google Colab via the official `colab` CLI**.

## Mental model

```text
Codex / AGY / Claude Code / OpenCode
                 │
                 │ existing harness
                 ▼
        remote-compute skill
                 │
                 │ policy / workflow
                 ▼
        official provider CLI
                 │
                 ▼
          remote compute
```

The host agent keeps responsibility for planning, retries, permissions, delegation, and verification. The provider CLI keeps responsibility for provisioning and execution. This package only connects the pieces.

## Why

Typical workflow:

1. Develop locally.
2. Keep reproducible source state in Git when exact revision matters.
3. Use remote compute only when local CPU, RAM, GPU, VRAM, or platform support is insufficient.
4. Keep large assets such as model weights, datasets, checkpoints, and generated media outside Git, for example in Google Drive.
5. Copy the hot working set to the remote worker's local disk before compute-heavy use.
6. Treat remote workers as disposable.
7. Persist important state outside the worker and collect artifacts before shutdown.

The same policy works for model training, ComfyUI, CUDA benchmarks, rendering, data processing, compilation, or arbitrary Linux workloads. There is no Sonata-specific or ComfyUI-specific runtime logic here.

## Supported agent hosts

The setup currently detects these CLIs on `PATH`:

- `codex`
- `agy`
- `opencode`
- `claude`

At least one supported host is enough. You do **not** need to install every supported agent.

Skill installation is host-aware instead of assuming every client shares one directory:

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

## Requirements

- Node.js 18+
- at least one supported agent CLI
- for the current provider: the official Google Colab CLI

Google's Colab CLI currently supports Linux and macOS. On Windows, run `remote-compute` inside WSL until upstream Windows support exists.

Official Colab CLI installation:

```bash
uv tool install google-colab-cli
```

or:

```bash
pip install google-colab-cli
```

The setup command can offer to install it when it is missing.

## Install

Until an npm release exists:

```bash
npm install -g github:Lotargo/remote-compute
```

Then:

```bash
remote-compute setup
```

After a future npm release:

```bash
npm install -g @lotargo/remote-compute
```

## Commands

### `remote-compute setup`

Detects installed agent hosts, installs or refreshes the bundled `remote-compute` skill, checks the Colab CLI, and reports the remaining authentication step when necessary.

```bash
remote-compute setup
remote-compute setup --install-colab
remote-compute setup --codex
remote-compute setup --agy --opencode
remote-compute setup --force
```

Host flags:

```text
--codex
--agy
--opencode
--claude
```

Without host flags, setup targets every supported host that is actually detected.

`--force` only refreshes a skill directory that still identifies itself as managed by this package. An unrelated skill with the same name is never overwritten.

### `remote-compute doctor`

Checks the real integration rather than only testing whether files exist:

- supported host CLI discovery;
- expected skill directories;
- exact packaged-skill ownership versus modified/unrelated copies;
- `colab` availability;
- a read-only Colab sessions query;
- optional `gcloud` availability;
- platform compatibility.

```bash
remote-compute doctor
remote-compute doctor --codex
```

The report uses `OK`, `WARN`, `INFO`, and `FAIL`. A failing required check produces a non-zero exit status.

### `remote-compute auth`

Starts the official Google Application Default Credentials browser flow through `gcloud`, using the scopes required by the Colab CLI, then verifies access with a read-only Colab command.

```bash
remote-compute auth
```

This project does not receive, proxy, print, or store Google credentials. Authentication remains owned by Google's tooling.

### `remote-compute uninstall`

Removes only unmodified skill directories that exactly match the packaged skill. If a user has changed a managed skill, it is preserved instead of being deleted.

```bash
remote-compute uninstall
remote-compute uninstall --codex
remote-compute uninstall --dry-run
```

Provider CLIs and Google credentials are never removed.

## Agent behavior

The bundled skill deliberately stays small. Its main rules are:

- prefer local execution when local resources are sufficient;
- use remote compute as a capability, not as a second planning system;
- query the provider's own self-documentation instead of guessing provider flags;
- use exact Git revisions for reproducible jobs;
- do not commit or push user work without permission;
- use disposable file transfer for quick uncommitted experiments;
- keep large binaries outside Git;
- copy hot assets to the remote worker's local disk before repeated compute-heavy access;
- checkpoint long jobs to persistent external storage;
- collect artifacts before shutdown;
- stop unused paid compute.

For Colab-specific details the skill tells the agent to consult the installed provider directly:

```bash
colab skill
colab help
colab help <command>
```

This avoids duplicating Google's fast-changing CLI documentation inside this repository.

## Architecture

The setup layer is split into small modules:

```text
src/
├── cli.mjs          command routing and UX
├── client_cli.mjs   cross-platform executable discovery and CLI launching
├── client_paths.mjs host path resolution / XDG handling
├── hosts.mjs        supported host definitions and skill targets
├── skills.mjs       ownership-safe skill install/remove
└── colab.mjs        provider bootstrap and official auth handoff
```

The host-integration layer intentionally follows patterns already proven in `Lotargo/memory_plugin`: centralized client paths, Windows npm-shim handling, host-specific targets, ownership-aware cleanup, native tooling first, and temp-environment tests.

There is still no custom Colab API client and no second harness.

## Local development

No CI/CD or GitHub Actions are configured for now. Validation is intentionally local.

```bash
git clone https://github.com/Lotargo/remote-compute.git
cd remote-compute

npm run check
npm test
npm link

remote-compute doctor
remote-compute setup
```

The tests use temporary HOME/workspace/bin directories and fake CLIs so setup primitives can be exercised without modifying real Codex, AGY, OpenCode, or Claude Code configuration.

## What this project intentionally does not do

- no second agent harness;
- no custom Colab API client;
- no credential storage;
- no workload-specific runtime;
- no model or dataset hosting;
- no automatic Git commits or pushes;
- no account rotation or quota circumvention;
- no CI/CD in this repository for now.

If repeated provider workflows later prove too error-prone as prose, they can become small deterministic helpers without moving planning out of Codex, AGY, Claude Code, or OpenCode.

## Roadmap

The skill is provider-neutral even though Colab is the first provider. Possible future adapters can include SSH workers, local Docker, RunPod, Vast.ai, or GCP without changing the agent-facing mental model.

The next design rule is simple: only add a wrapper when real usage proves that the official provider CLI plus the skill is not reliable enough.

## Status

Early alpha. The goal is a small, inspectable bootstrap utility with minimal moving parts and zero runtime dependencies.
