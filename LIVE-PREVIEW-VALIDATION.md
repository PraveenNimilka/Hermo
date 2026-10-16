# Actual website preview and generated-media targeting

16 October 2026. Hermo remains early access.

## What changed

Connected Chrome now has a Website view displaying the actual authorized tab's
appearance. Detected fields remains a separately named DOM inspection. The
companion's explicit Enable live preview action grants a short-lived tabCapture
stream, sampled in a hidden offscreen document. It works while Hermo has focus;
there is no visible controller tab or iframe dependency. It is a periodically
updated visual preview, not a remote interactive browser. Record through the
existing Interact controls.

Sharing is limited to one authorized tab, video only, bounded JPEG dimensions
and size, owner-authenticated requests, 15 minutes maximum and two minutes idle.
Stop preview leaves automation connected. Tab closure, origin/path exit and
connection teardown stop capture. Worker recovery closes orphan capture rather
than silently restoring visual sharing. Credential, sign-in and challenge pages
do not deliver preview images. No frames or stream identifiers are persisted.
Automatic active-tab screenshots were removed: switching foreground tabs cannot
substitute another tab's pixels.

Generated-media selection now uses latest-result semantics inside explicitly
marked assistant responses or result logs. Recording one image no longer binds
the workflow to that image's temporary turn ID. Ordinary catalogs retain their
individual element selection. Avatar/icon/navigation images are excluded from
latest-result targeting. Pending image/video/audio loads are not completed
outputs. Existing baseline/freshness verification still rejects old results.

The existing draft editor adds Result targeting presets for latest image, video
and audio results. Media outputs retain their media type and are not classified
as chat replies. Saving a repair invalidates the draft's test evidence; the
published revision and consumer key remain unchanged until verified publication.
No saved workflow is silently rewritten.

## Required steps for existing installations

1. Reload unpacked companion **0.7.0** in `chrome://extensions`.
2. Refresh/unlock Hermo and reconnect the intended website tab.
3. Open the companion on that website and choose **Enable live preview**.
4. For the failed image workflow, inspect the website before retrying because
   its submission may already have completed. Open its draft's **Edit workflow
   steps and extraction → Output mappings → Result targeting** and select
   **Latest image result**. Save, verify with a new prompt, then publish.

The preset needs a supported marked response/result container. Other websites
require selecting or repairing their own output selector. Protected, expired,
blob or canvas-only assets do not become portable public URLs. Hermo does not
proxy account cookies or convert unsupported media into verified API output.

## Verification evidence

- TypeScript and Vite production build passed: `work/live-preview-build.log`.
- New preview-state/layout/draft-repair test passed at 1440, 768 and 375px.
  Screenshots under `work/connected-preview-ui/` were visually inspected. This
  layout test explicitly intercepts snapshot responses; it does not certify
  extension capture. The independent live-preview browser test uses actual
  Chrome tab capture and verifies real changed pixels.
- Lifecycle unit tests verify explicit grants, expiry, malformed/stale frames,
  startup cancellation, delayed-request isolation, cross-connection switching,
  failed-start cleanup and serialized teardown. Offscreen freshness follows
  actual incoming video-frame counters, independently of snapshot requests;
  repeatedly sampling an old decoded frame cannot refresh its timestamp.
- DOM tests cover temporary media IDs, new-result freshness, image loading,
  avatar filtering, repair presets and unchanged catalog semantics. A connected
  engine test executes generation and verifies the new result through real DOM
  inspection and extraction.
- Runtime activation passed consistent SQLite backup, integrity and foreign-key
  checks. All 3 connections, 5 workflows, 15 keys, 40 runs, saved browser and
  publication records were preserved. Hash comparisons verified encrypted
  workflow/connection payloads, API-key identities/scopes and DPAPI master context.
  Health and built assets return 200; unauthenticated owner overview returns 401.
  Evidence: `work/live-preview-runtime-validation.json`.

- Final affected checks: **26/26 passed, 0 skipped**, 21.8 seconds, using
  `node --test --test-concurrency=1 tests/browser-inspection.test.mjs tests/generated-media-targeting.test.mjs tests/live-preview.test.mjs tests/live-preview-offscreen.test.mjs tests/live-preview-browser.test.mjs tests/visual-preview-commands.test.mjs tests/connected-preview-ui.test.mjs`.
  Evidence: `work/live-preview-verified-tests.log`. This includes actual Chrome
  background pixels and worker recovery, stale/unsafe-frame rejection, all final
  lifecycle fixes, media selectors, responsive UI and saved draft repair.
- Full regression: **238 passed, 1 failed, 0 cancelled, 0 skipped**, 658.9 seconds
  (`work/live-preview-full-final.log`). The sole failure was an older assertion
  expecting automatic active-tab screenshots without explicit visual sharing.
  It had already been loaded when the test was corrected to require no capture
  without opt-in. The corrected inspection file passes in the final 26/26 run.
  The complete suite was not rerun after that assertion correction; this is not
  reported as a clean full-suite pass. Recording, publication, REST/MCP, managed
  execution, typed extraction, queueing, cancellations and runtime recovery
  passed in the broad run.
- An earlier concurrent focused attempt had one Chrome startup closure before
  page execution. The final isolated run passed without weakening assertions or
  adding runtime retries. Initial preview startup and lifecycle defects found
  during development were repaired and covered by the final checks.
- Final live `/health` and updated setup-guide checks returned 200. Runtime is
  independently running on loopback port 4318. Its saved workspace was not
  replaced with any test data.

## Remaining limitations

These tests use owned fixtures and synthetic credentials. The user's private
ChatGPT image-generation workflow must still be reselected and retested in their
authorized account. No universal website compatibility or provider-account
certification is claimed. Real website generation time, DOM layout, account
permissions and asset accessibility still determine whether a run verifies.

The independent runtime, computer and authorized Chrome session remain required.
Live preview needs a fresh user opt-in after expiry or worker recovery. Closing
the dashboard does not terminate the runtime; idle visual sharing expires.
