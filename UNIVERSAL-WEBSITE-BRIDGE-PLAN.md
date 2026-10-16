# Hermo: browser task to verified API

The product is a bridge for user-authorized website workflows. A provider subscription or provider API connector is not a prerequisite. Existing recorded actions, workspace authentication, browser pairing, keys and API/MCP contracts remain compatible.

## Task families

| Task | Common websites | Inputs and useful results |
| --- | --- | --- |
| Chat and text | AI assistants, writing, translation, coding | Prompt and options to completed text response |
| Generate media | Image, video, audio and design tools | Prompt and settings to a new asset URL, caption or download link |
| Read data | Weather, finance dashboards, status and analytics | Optional filters to observed values, units and context |
| Search and extract | Catalogs, directories, knowledge bases and portals | Query or record reference to selected result fields |
| Submit and update | Forms, support, CRM and admin tools | Recorded fields to confirmation or updated record |
| Custom | Any supported combination of interactions | Owner-defined controls, outputs and verification |

These choices guide the builder; they are not separate provider integrations or a whitelist of websites. One browser execution engine handles the demonstrated controls and selected outputs. New task types cannot weaken exact-origin, account, owner or key authorization.

## Architecture changes

1. Remove the direct provider-specific plan connector and its exclusive live routes/components/examples. Retain encrypted historical workspace data without using it or changing Google workspace sign-in.
2. Keep inputs, actions and outputs independent. Add explicit media-attribute outputs while retaining string API contracts. Visible text is not the only possible result.
3. Validate selected-tab origin and website readiness (or isolated account), nonempty outputs and selected checks. Generated media and explicit changed-result checks compare to the pre-submission baseline and wait for a completed new result. Ordinary read actions can return unchanged valid data.
4. Give actions a bounded execution budget, with longer defaults for media generation. Never resubmit an uncertain website mutation automatically.
5. Persist the category and budget with each new action. Old action versions, keys and ID-based contracts remain unchanged.
6. Make the visual workflow explicit: choose website, demonstrate a task, select results, verify, publish a scoped API. Use restrained neutral surfaces, one accent and shared accessible states.

## Verification

Use disposable owner accounts and owned sites for chat, media generation, read-only values, search and submission. Exercise the actual browser, built UI, generated keys, REST and MCP; include delayed, stale, missing, cancelled and wrong-origin, sign-in and permission failures. Recheck live public practice sites separately. Personal provider accounts and paid generation are not used by automated checks.
