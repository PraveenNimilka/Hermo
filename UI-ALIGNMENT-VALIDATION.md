# Monochrome UI and alignment validation

## Shared controls and execution panel — 15 October 2026

The execution-browser dropdown now has consistent chevron padding, readable
width, zero doubled field margins and a content-width retest button aligned to
its field. Dropdowns throughout the dashboard share the same native behavior and
neutral arrow inset. Output/input editor groups use one spacing rhythm. API-key
buttons align to their inputs through grid rows; long action text wraps safely.
Forced-colors mode keeps the system dropdown arrow.

The presentation-only alignment run passed **10/10** existing Chrome UI checks.
The enhanced execution-panel test then verified exact insets, margins, maximum
width and mobile fit at 1440, 768 and 375px. Its screenshots are under
`work/next-release-ui/428940acfea0/`. These checks are also part of the media
release regression. See [MEDIA-PREVIEW-VALIDATION.md](MEDIA-PREVIEW-VALIDATION.md)
for the current build, final test evidence and related media additions.
The final combined suite passed **219/219**; the final focused schema/playback/UI
follow-up passed **18/18**. The rebuilt interface is live on port 4318 with the
current workspace preserved. Refresh/unlock and reconnect after the runtime update.

## Project selector refinement — 15 October 2026

The project picker now uses a visible 12px label with the management button
aligned beside it, a full-width 44px native select, the shared 8px radius,
neutral surfaces and a consistent chevron. Workspace/project/navigation gaps
follow the existing spacing scale. Long workspace names wrap inside the card;
the select retains its full-name tooltip. Mobile controls retain touch targets.

Added the missing `.sr-only` utility for actual screen-reader-only content.
The project label is intentionally visible and linked to its native control.
Project-management forms and their divider now have explicit, consistent spacing.
Project behavior, API/runtime processes and existing workspace data are unchanged.

Applied the existing Baseline UI, UI UX Pro Max, Frontend Design and accessibility
guidance. TypeScript/Vite build passed (`work/project-sidebar-build.log`);
final entries: `index-DNPUYRz6.js`, `index-9SaJkHq4.css`.

Existing browser checks: **9 passed, 0 failed, 0 skipped**, 30.3 seconds:
`node --test --test-concurrency=1 tests/next-release-ui.test.mjs tests/runtime-ui.test.mjs tests/universal-ui.test.mjs`.
Evidence: `work/project-sidebar-ui-tests.log`. Checks cover all six screens,
desktop/tablet/phone and short landscape, project creation/switching, keyboard
focus, real recording/publication and scoped-key playground execution.
Desktop and phone screenshots were inspected under
`work/runtime-ui/119e24dc0cc6/` and `work/next-release-ui/9bf4b6fd6095/`.
The existing owner dashboard is locked in the in-app browser; it was not unlocked
or changed for testing. Refresh and unlock to see the rebuilt interface.

## Earlier alignment milestone

14 October 2026. The user requested consistent alignment/margins throughout Hermo and black-and-white styling in place of the previous blue accent.

## Changes

- Shared tokens now use white, black and neutral grays for surfaces, controls, navigation, chart/focus states and status labels. Status text/icons preserve meaning. Website screenshots and generated media retain their original colors.
- Action cards group connection and category with a visible gap. Titles/IDs wrap without clipping, and action footers align within rows even when titles differ in length. Padding and content edges remain consistent.
- Grid children no longer add panel margins on top of grid gaps. Form guidance, saved-browser controls, section headers, contract columns and dialog spacing use shared spacing rules.
- Phone top bars reserve room for the breadcrumb and controls; the redundant local badge is hidden on narrow screens instead of overflowing the document.
- Consumer apps, companion popup/panel and Hermo's own setup/guide pages use the same neutral treatment. No backend, authentication, saved-data, API, recording or browser-permission behavior changed.
- The preference is recorded in `design-system/hermo/MASTER.md` for future work.

## Verified

- `npm run build` passes TypeScript and Vite. Current assets: `index-BYhuTNlU.js`, `index-CcaklhCm.css`. The running app at `http://127.0.0.1:4318/` returns 200 and serves this entry.
- `node --test tests/universal-ui.test.mjs`: **7 passed, 0 failed**, 14.7 seconds. All six screens at 1440, 768, 375 and 844×390 landscape, plus actual recording/verification/publication, typed deletion, keyboard focus, unlock and both consumer setup screens. Mixed-length cards are checked by geometry for metadata gaps, shared insets and footer alignment.
- `tests/management-ui.test.mjs`: **1 passed**, including action/key/browser management, exact typed deletion, pagination, search and preserved history.
- `tests/companion-transport.test.mjs` and `tests/companion-stop-race.test.mjs`: **2 passed**, including popup closure, worker idle, website reload, Stop, owner lock and pending-command cancellation. Panel changes were styling only.
- The first UI run found a real 4 pixel phone top-bar overflow. It was repaired; final viewport checks pass without hiding page overflow.
- Computed own UI colors are checked for neutral RGB values. Static declaration audit checked 3389 declarations across the five main/consumer/companion stylesheets, with zero colored hexadecimal values. External website preview pixels are excluded deliberately.
- `git diff --check` passes. The prior full 130 test backend regression remains documented in `UNIVERSAL-WEBSITE-BRIDGE-VALIDATION.md`; this presentation-only pass used the relevant UI/companion checks instead of repeating unrelated backend tests.

Evidence: `work/universal-ui/b0251e5a12bd/evidence.json` and 39 screenshots, `work/monochrome-expanded-tests.log`, `work/monochrome-final-tests.log`, `work/monochrome-ui-tests.log`. Main private workspace was not reset; browsers, connections, actions, keys and user data are preserved.

Refresh Hermo to load the new assets. Reload the companion extension to apply the matching website-panel styling; its protocol/version remains 0.4.0.
