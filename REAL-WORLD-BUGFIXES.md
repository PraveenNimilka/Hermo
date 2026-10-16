# Real-world findings and fixes

## Managed browser crash diagnostics

**Observed:** terminating the actual disposable managed Chromium process during
an active read left the run with a generic execution error. This did not fabricate
success, but it obscured whether repairing an element or restoring browser
availability was the right next step.

**Changed:** `server/browser.mjs` checks the execution browser's connection in its
failure path and reports `BROWSER_DISCONNECTED` with `managed_browser` context.
Cancellation is checked first so context closure does not replace its intended
cancellation cause. `server/run-state.mjs` provides a safe, actionable managed
browser message. No automatic retry or broader browser authority was introduced.
Potentially submitted mutations retain uncertain-outcome handling.

**Verified:** `tests/managed-faults.test.mjs` uses a real local browser and public
HTTP workflow provisioning. It tests missing output, active cancellation, workflow
deadline and an actual browser-process crash. The crash targets only the PID
identified by that test's own CDP session. The failed run returns no result;
retrieving its original idempotent receipt does not relaunch; a separately
admitted fresh request can start a replacement browser. The focused managed-fault,
run-state and startup checks passed **13/13**, with no skipped tests. Final full
suite results are in `validation/results/release-summary.json`.

## Consumer mobile overflow

**Observed:** a 375-pixel browser viewport showed horizontal overflow when nested
JSON/table content expanded a grid column beyond the screen.

**Changed:** consumer layout tracks use `minmax(0, 1fr)` and children can shrink;
JSON/table scrolling is contained within its panel. The page does not hide global
overflow to conceal broken layout.

**Verified:** actual live results were inspected at desktop and mobile widths.
The UI acceptance script asserts document width and captures both viewports for
each app. API keys remain masked and are not included in JSON evidence.

## Companion interface

The selected-tab popup, manual connection page, diagnostic controller and website
panel now share restrained monochrome styles and the existing Hermo crab logo.
Spacing, typography, control alignment, focus states, responsive layouts and
progressive disclosure of the local runtime address were improved. The primary
pairing action fits the native popup; capture and stop controls remain explicit.
No extra host permission or transport protocol change was needed for this redesign.

Real Chrome companion checks cover popup layout, keyboard/focus behavior, panel
disclosure, branded assets and important connected/error states. Existing transport,
diagnostic and live preview checks remain in the regression suite.
See the [actual native companion popup](validation/evidence/companion-popup.png).

## Validation harness corrections

- External managed workflow waiting initially selected a repeated product row.
  Hermo correctly rejected ambiguity. The test now waits for the unique page
  heading and extracts repeated rows using an explicitly declared array.
- A fixed test port collided during overlapping verification processes. The live
  harness now selects an ephemeral port, waits for its child runtime's startup
  announcement, and uses unique storage. The full suite runs serially without
  parallel focused suites. No owner workspace was reset to resolve the collision.
- The UI response observer now waits for already-received response bodies before
  asserting recorded terminal results. This removes a race between Playwright's
  response observer and the actual UI request handler without simulating results.

## Preserved boundaries

Published IDs, compatibility endpoint paths, scopes, immutable revision behavior,
encryption, explicit tab authorization, origin validation and output verification
remain intact. Six consumer apps use only public interfaces. User workspace data,
keys, browser profiles and environment files are excluded from the release.

Remaining limitations, external blockers and reproducible acceptance commands are
documented in [REAL-WORLD-VALIDATION.md](REAL-WORLD-VALIDATION.md).
