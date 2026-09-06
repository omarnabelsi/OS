## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, not the patch. Link an issue if there is one. -->

## How it was verified

<!-- Delete what does not apply. "It builds" is not verification. -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `cargo test --workspace`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] Ran the real app (`npm run tauri:dev`) and drove the changed screens with a gamepad
- [ ] Ran the browser mock (`npm run dev`) and drove them with a keyboard

## Contract and compatibility

- [ ] No IPC change
- [ ] IPC change: both mirrors updated (`crates/aura-core/src/model.rs` + `src/bridge/types.ts`),
      `docs/IPC.md` table updated, and a CHANGELOG entry added
- [ ] Theme format change: `docs/THEME_FORMAT.md`, `crates/aura-core/src/theme/validate.rs` and
      `scripts/validate-theme.mjs` all updated together

## Risk

<!-- Anything touching the shell host, process watching or the registry needs a note here:
     what happens if it goes wrong, and how the user recovers. See docs/RISKS.md. -->

## Screenshots

<!-- Any visible change needs a before/after. Motion changes are better as a short clip. -->
