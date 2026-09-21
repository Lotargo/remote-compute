---
name: remote-compute
description: Use remote compute when local CPU, RAM, GPU, VRAM, platform support, or isolation is insufficient. Prefer local execution when it is adequate; use the installed provider CLI for disposable remote workers, persistent external state, large assets, and artifact recovery.
compatibility: Current provider requires the official Google Colab CLI (`colab`); remote-compute transparently bridges it through WSL on Windows when needed.
metadata:
  managed-by: remote-compute
  provider: colab
---

# Remote Compute

Use the host agent's existing planning, tool loop, permissions, and verification. This skill does not create a second harness.

The current remote provider is Google Colab through Google's official `colab` CLI. `remote-compute colab ...` is a transparent compatibility gateway: it invokes native `colab` where supported and automatically routes through WSL on Windows. Provider semantics still belong to the official Colab CLI.

## First principles

1. Prefer local execution when local resources are sufficient.
2. Use remote compute when the task needs hardware or platform capabilities that are unavailable or impractical locally.
3. Treat every remote worker as disposable.
4. Keep important state outside the worker.
5. Do not duplicate provider behavior in ad-hoc scripts when the provider CLI already exposes it.
6. Do not store or proxy provider credentials yourself.
7. Do not make the user manually move their development workflow into WSL just to reach Colab.

## Discover provider behavior from the provider

Before guessing Colab flags or workflows, inspect the installed CLI through the compatibility gateway:

```bash
remote-compute colab skill
remote-compute colab help
remote-compute colab help <command>
```

Use the provider's current self-documentation as the source of truth. The Colab CLI changes faster than this skill should.

For read-only environment checks, prefer commands such as:

```bash
remote-compute colab sessions
remote-compute colab status
```

`remote-compute` uses the official Colab CLI OAuth2 provider by default. On first login, `remote-compute auth` launches the provider's own remote copy-paste flow: Colab prints a Google authorization URL, the user signs in in their normal browser, then pastes the returned authorization code into the terminal. The Colab CLI owns and caches that token; `remote-compute` does not receive or store it.

Do not require `gcloud` for the normal managed login flow. `gcloud` is only relevant when the user explicitly chooses Colab's ADC mode with `--auth=adc`.

If authentication fails in a non-interactive agent run, ask the user to run `remote-compute auth`. Never request raw OAuth tokens, cookies, authorization codes, or credential files in chat.

Do not reason about `wsl.exe`, drive-letter mount points, or Linux distribution internals unless diagnosing the compatibility layer itself. `remote-compute` owns that deterministic platform decision.

## Windows path behavior

On Windows, keep the user's repository in its normal Windows location. The provider bridge starts WSL in the current Windows working directory, so prefer relative local paths when sending files to the provider.

Do not assume a drive such as `C:`, `F:`, or `Z:` maps to a hardcoded `/mnt/<letter>` path. If an absolute Windows path must be translated for a Linux-side command, use:

```powershell
remote-compute wsl-path "C:\path\to\file"
```

The bridge asks WSL's own `wslpath` implementation and therefore respects the user's WSL mount configuration. A path on a mapped/network drive may legitimately be unavailable to WSL; report that condition instead of inventing a mount path.

## Decide how to move source code

Choose between a reproducible Git workflow and a disposable file transfer.

### Reproducible job

Use this for training runs, benchmarks that should be repeatable, long jobs, or anything whose exact source revision matters.

1. Inspect the local Git state.
2. Prefer an existing pushed commit and record its exact SHA.
3. If the working tree is dirty, do **not** silently commit or push user changes. Either:
   - ask for permission to commit/push, or
   - use the disposable transfer path below.
4. On the worker, clone/fetch the repository and check out the exact intended revision.

The remote job should be explainable by repository revision + external assets + command + environment.

### Disposable experiment

Use this for small probes, temporary scripts, or uncommitted experiments where creating Git history would add noise.

Transfer only the required files using the provider CLI's supported upload/exec mechanisms. Avoid copying an entire large workspace when a small script or subset is sufficient.

For small one-off inputs and outputs, prefer the provider's direct file transfer commands instead of mounting persistent storage:

```bash
remote-compute colab upload -s <session> <local> <remote>
remote-compute colab download -s <session> <remote> <local>
```

Check `remote-compute colab help upload` / `download` before relying on exact provider flags.

## Persistent data and Google Drive

Do not put large model weights, datasets, checkpoints, generated media, or similar binary assets into Git just to reach a remote worker.

For Google Colab, prefer the provider's own Drive integration instead of building a separate Google Drive API client or storage wrapper. The official CLI exposes Drive mounting through the same gateway:

```bash
remote-compute colab drivemount -s <session>
```

By default the provider mounts Drive at `/content/drive`; inspect `remote-compute colab help drivemount` before depending on current flags or alternate paths.

Drive mounting is interactive and may require browser consent plus a terminal confirmation. Do not leave a non-interactive agent waiting on that prompt. Ask the user to complete the provider's consent step, then continue once the mount succeeds.

Choose storage by lifecycle:

```text
Git / exact revision       = reproducible source code
upload / download          = small disposable file transfer
Google Drive               = persistent large assets, checkpoints, shared outputs
remote VM local disk       = hot working set for active computation
```

For compute-heavy workloads, copy the hot subset from Drive to the remote VM's local disk before repeated reads/writes. Use Drive as durable storage, not as the performance-critical working directory. Periodically persist recoverable checkpoints and important artifacts back to Drive when losing the remote VM would otherwise lose work.

Do not assume Drive is mounted merely because the Colab session exists. Verify the mount and required files before starting an expensive job.

## Long-running jobs and state

Remote runtimes can disappear. Design long jobs so losing a worker is recoverable.

Persist externally at useful intervals:

- model checkpoints;
- optimizer/training state when needed for true resume;
- experiment configuration;
- logs/metrics needed to diagnose progress;
- important generated artifacts.

When resuming, locate the latest valid persistent state, restore it to the new worker, and continue from there. Do not pretend a job is resumable if only model weights were saved but optimizer or other required state was not.

## Execution

Use the simplest provider operation that fits the workload.

- Prefer one-shot/ephemeral execution for bounded jobs when the provider supports automatic cleanup.
- Use a named persistent session when multiple remote steps must share state.
- For arbitrary Linux workloads, use the provider's supported shell/console/SSH facilities rather than forcing everything through Python.
- Avoid interactive commands from a non-interactive agent unless the provider explicitly supports piped/headless usage.
- Invoke Colab through `remote-compute colab ...` so the same agent workflow works on Windows, Linux, and macOS.

For Colab-specific command details, read `remote-compute colab skill` immediately before complex operations.

## Verification

Remote execution does not reduce the quality bar.

After the workload:

1. check the process exit status;
2. inspect relevant logs or metrics;
3. verify expected artifacts exist and are non-empty;
4. download or persist artifacts before destroying the worker;
5. report the exact revision/config used when reproducibility matters.

Do not claim success solely because a remote command started.

## Cleanup

Paid/limited remote compute must not be left running accidentally.

- Stop sessions when they are no longer needed.
- Prefer provider one-shot commands that self-clean for bounded jobs.
- Before finishing a task, check for orphaned sessions when appropriate.
- Never keep a worker alive merely as storage.

## Boundaries

Do not:

- build a second agent planner around the provider;
- bypass provider/account quotas or rotate accounts to evade limits;
- store user credentials inside this skill or repository;
- automatically commit/push user changes without permission;
- assume a particular GPU is available until allocation succeeds;
- hardcode Windows drive letters or `/mnt/<letter>` translations;
- build a parallel Google Drive API/storage layer when the provider CLI already exposes Drive mounting;
- make workload-specific assumptions such as "this is always ML training" or "this is always ComfyUI".

The capability is simply remote compute. The workload can be training, inference, compilation, CUDA tests, data processing, rendering, benchmarks, or something else entirely.
