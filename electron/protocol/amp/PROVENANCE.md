# AMP vendored source — provenance

This directory is a **verbatim (byte-for-byte) copy** of the published TypeScript
source of the Attention Manifest Protocol library. It is third-party code that is
vendored into this repository as-is. It is **not** a fork.

## Source

| Item | Value |
| --- | --- |
| Source repository (absolute path) | `R:\project\attention-manifest-protocol` |
| Package name | `attention-manifest-protocol` |
| Package version | `0.4.1` |
| Git commit | `e40634a2dd88cbdf684e8a53b178b00f4f3fb5fe` (`refs/heads/main` of the source working tree) |
| Source subtree | `R:\project\attention-manifest-protocol\src` |
| Vendored into | `R:\project\periodicity-calendar-react\electron\protocol\amp` |
| Import time | 2026-10-29T05:33:13.2806857+08:00 (Asia/Shanghai, UTC+08:00) |
| License | Apache-2.0 — see `LICENSE` and `NOTICE` in this directory |

## What was copied

* All 42 module directories under `src/` (296 `.ts` files), recursively, keeping
  the exact directory layout and file names.
* The library entry point `src/index.ts` → `electron/protocol/amp/index.ts`.
* `LICENSE` and `NOTICE` from the source repository root, byte-identical.

Total: **297 `.ts` files** plus `LICENSE`, `NOTICE` and this file.

## Copy rules

1. **Verbatim only.** Every copied file is byte-identical to its source file
   (verified with SHA-256 per file after copying; 297/297 hashes matched,
   0 mismatches). Nothing was reformatted, renamed, reordered or "fixed":
   * 4-space indentation and original line endings are preserved;
   * comments are preserved, including commented-out code and typos;
   * import specifiers keep their explicit `.ts` extensions
     (e.g. `from "./attention/index.ts"`) — this is intentional in the upstream
     library and is resolved through
     `compilerOptions.allowImportingTsExtensions` in `tsconfig.json`;
   * blank lines and end-of-file newlines are preserved.
2. **Nothing extra was added.** No helper, shim, index barrel, `.d.ts`
   augmentation or re-export file exists inside this directory. The only
   non-upstream files here are `LICENSE`, `NOTICE` and `PROVENANCE.md`.
3. **Excluded demo entry points.** `tsconfig.build.json` of the source
   repository excludes `src/main.ts`, `src/counter.ts` and `src/style.css`.
   These are the Vite demo application of the upstream repository and are not
   part of the published library, so they were **not** copied:
   * `src/main.ts` — Vite demo bootstrap (DOM app);
   * `src/counter.ts` — Vite demo widget;
   * `src/style.css` — Vite demo stylesheet.
   No other module was skipped. In particular, all 11 modules that import
   `node:sqlite` were copied in full (`authz/authz.ts`,
   `concurrency/idempotency.ts`, `concurrency/worker.ts`, `ipc/mailbox.ts`,
   `kernel/scheduler.ts`, `lock/lease.ts`, `process/executionStore.ts`,
   `process/process.ts`, `progress/progress.ts`, `registry/registry.ts`,
   `thread/thread.ts`).
4. `LICENSE` and `NOTICE` are copied verbatim and **must not be removed or
   edited**: section 4(d) of the Apache License 2.0 requires redistributions to
   carry the `NOTICE` file.

## Consuming this code

* Type checking: the vendored sources require TypeScript with
  `lib: ["ES2023", "DOM"]` and `moduleResolution: "bundler"` plus
  `allowImportingTsExtensions` (the upstream `tsconfig.json` uses
  `target: "es2023"`). The host repository's `tsconfig.json` mirrors those
  settings (`target: "ES2023"`,
  `lib: ["ES2023", "DOM", "DOM.Iterable"]`).
* `node:sqlite` typings come from `@types/node` ≥ 22.5; this repository pins
  `@types/node` `26.6.5`, the same version the upstream repository builds with.
* Linting: this directory is excluded from the host application's ESLint run
  (`ignorePatterns` contains `electron/protocol` in `.eslintrc.cjs`), because it
  follows upstream's formatting (2-space indent, single quotes) rather than the
  host application's style rules.

## ⚠️ Do not edit these files by hand

**Verbatim copy — manual edits are forbidden.** Any local change makes future
upstream upgrades unverifiable and silently diverges this fork from the
released library.

* To **upgrade**, delete this directory's upstream content and copy the whole
  `src/` tree from the new upstream tag/commit again, in one shot
  ("整体重拷"), then re-run the byte comparison and update the table above
  (version, commit, import time, file counts).
* To **patch upstream**, send the change upstream instead of editing here; the
  fix then arrives with the next re-copy.
* If host-side integration needs different behaviour, put an adapter/wrapper
  *outside* this directory (e.g. `electron/amp/`) and keep `electron/protocol/`
  pristine.
