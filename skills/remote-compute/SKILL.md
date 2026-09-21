---
name: remote-compute
description: Use remote compute when local CPU, RAM, GPU, VRAM, platform support, or isolation is insufficient. Prefer local execution when it is adequate; use the installed provider CLI for disposable remote workers, persistent external state, large assets, and artifact recovery.
compatibility: Current provider requires the official Google Colab CLI (`colab`).
metadata:
  managed-by: remote-compute
  provider: colab
---

# Remote Compute

Use the host agent's existing planning, tool loop, permissions, and verification. This skill does not create a second harness.

The current remote provider is Google Colab through Google's official `colab` CLI. Treat provider commands as an external capability, not as a new orchestration layer.

## First principles

1. Prefer local execution when local resources are sufficient.
2. Use remote compute when the task needs hardware or platform capabilities that are unavailable or impractical locally.
3. Treat every remote worker as disposable.
4. Keep important state outside the worker.
5. Do not duplicate provider behavior in ad-hoc scripts when the provider CLI already exposes it.
6. Do not store or proxy provider credentials yourself.

## Discover provider behavior from the provider

Before guessing Colab flags or workflows, inspect the installed CLI:

```bash
colab skill
colab help
colab help <command>
```

Use the provider's current self-documentation as the source of truth. The Colab CLI changes faster than this skill should.

For read-only environment checks, prefer commands such as:

```bash
colab sessions
colab status
```

If authentication fails, ask the user to run `remote-compute auth` or complete Google's official authentication flow. Never request raw OAuth tokens, cookies, or credential files in chat.

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

## Large assets

Do not put large model weights, datasets, checkpoints, generated media, or similar binary assets into Git just to reach a remote worker.

Use persistent external storage such as Google Drive when the user has provisioned it. Keep a clear separation:

```text
persistent storage = source of truth for large assets and checkpoints
remote local disk   = hot working set for active computation
```

For compute-heavy workloads, copy required hot assets to the worker's local disk before repeated use rather than repeatedly reading them through a mounted remote filesystem.

Do not assume Drive is mounted. Provider-side Drive mounting may require a human/interactive step. If it does, ask the user to complete that step instead of hanging an agent on an interactive prompt.

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

For Colab-specific command details, read `colab skill` immediately before complex operations.

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
- make workload-specific assumptions such as "this is always ML training" or "this is always ComfyUI".

The capability is simply remote compute. The workload can be training, inference, compilation, CUDA tests, data processing, rendering, benchmarks, or something else entirely.
