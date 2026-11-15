# Verification record — initial implementation

Date: 2026-11-10. Target API release: DSH 0.2.2-rc.1 (`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`); runtime definitions read from the actual app.asar installation, exact source used only by offline fixtures.

## Scope

All writes are under `packages/dsh-resource-picker`. No active profile/config changes, package install, replacement server, authenticated browser workaround, token lookup, real Session creation, external QQ/remote delivery, or application reload was performed.

## Executed checks

Using system Node `node` v24.16.0 in this package directory:

1. `node build.mjs` and `node build.mjs --check` — pass. Dependency-free deterministic Client artifact generation, React/Zod supplied by official module table.
2. `node --check index.js`, `client.js`, `host.js`, `rpc.js`, `tests/runtime-loader.mjs` — pass.
3. With `DSH_SOURCE_ROOT` set to the exact-release source root, `node --test tests/*.test.mjs` — **27/27 pass**: 20 pure/domain/queue/Host-mock cases and 7 compiled-Client semantic DOM cases. This is DOM behavior, not screenshot or live GUI verification.
4. `node --import ./tests/runtime-loader.mjs --test tests/runtime.integration.mjs` — **2/2 pass**: real Cordis, Host and Client Typert Gateway, real strict Zod schemas and JSON Schema projection; owner/allowed-guest/missing-principal/trusted-in-process paths, namespace/descriptor/service/tool/command teardown and retained method revocation. Subjects are mounted manually in-process, not through Loader.
5. `node --expose-internals --import ./tests/runtime-loader.mjs --test tests/loader.integration.mjs` — **1/1 pass**: official Loader/Include parses the package-owned fixture YAML and mounts real TypertRegistry, RemoteAccess, Gateway and resource picker. Only external Workspace/Session inputs are mocked. All subject entries reach `FiberState.ACTIVE`; owner and allowed-global guest differ at the service guard; passive preview creates no Session; unregistering the plugin generation revokes its Service and strict descriptor with no SRC downgrade.
6. Manifest display resources and all 16 declared runtime/resource paths checked for existence; English/Chinese metadata complete. Icon is original static SVG. Rendering of installed inventory metadata/icon remains unverified.

The test-only loader reads exact source aliases and uses its existing TypeScript/pnpm dependencies. It emits no external build artifacts, installs nothing and owns no network listener. It is test infrastructure, not a runtime dependency.

## Behavior covered

- Type allowlist, single/multiple, mixed type versus parent/child independence, duplicate identity and maximum selection count.
- Stable full IDs, canonical Host title/preset result, current-workspace/session relation checks, file path validation and official `fs.contains` symlink containment.
- File API workspaceRoot remains the selected workspace even if a mocked Session cwd changes.
- Preview never activates/resumes/retains/creates a Session or selects a model; output excludes reasoning/tool/system/context and bounds text/media.
- Complete UTF-8 request/response envelope limits include wrappers and multibyte text.
- FIFO, queued and active abort, unload/overlay removal cancellation, no public queue accept method.
- Explicit choose is required, failed Host validation stays visible and unresolved, cancelled selection is not consent.
- Model/effort returns a suggestion only; explicit new-session double-click is deduplicated and cancel never deletes the created blank Session.
- File view requests the public `sidebar.files.tree` factory; no factory means explicit in-app fallback.

## Remaining acceptance work

- Install/activate through official plugin manager under lead coordination.
- Inspect actual Host/Client Service/slot registrations after installation and verify package resolution in the Desktop runtime.
- User-authenticated original GUI visual/keyboard/touch/light/dark/narrow-screen checks; no visual success is claimed here.
- Native read-only Chat factory and full native file-chooser result seam are absent. Capabilities report false and UI explicitly identifies the text/browser fallback. Future seam integration must remain passive and retain the original DSH renderer; it is not implemented by copying private Chat components.
- Restricted non-owner peers are intentionally unsupported by the aggregate picker RPC; do not treat local UI access hooks as a substitute for per-resource Gateway authorization.

Task stays in progress for lead review/installation and the remaining acceptance criteria. This record describes the first implementation increment, not final delivery of the full plugin series.
