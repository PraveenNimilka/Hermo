# Hermo interface direction

Hermo turns a task performed in a browser into a reusable, tested API. Every feature uses this universal website model; task categories guide recording and verification without tying execution to a particular AI provider. Preserve normal website authentication and approved browser actions.

## Tokens and hierarchy

Use Inter, already served locally, for headings and body. Use monospace only for endpoint paths, IDs and code. Page headings are 28px/600, section headings 18px/600, body 14px/400, controls 14px, secondary labels 12px minimum; mobile inputs 16px. Do not use uppercase or tracking to create hierarchy.

| Token | Color | Use |
|---|---|---|
| Canvas | #f7f7f7 | Quiet application background |
| Panel | #ffffff | Forms, data and task surfaces |
| Ink | #202020 | Primary content |
| Muted | #636363 | Secondary readable labels |
| Line | #e5e5e5 | Grouping and dividers |
| Accent | #202020 | Current location, primary action and focus |

Use black, white and neutral grays throughout Hermo. Status labels and icons distinguish results without relying on colored badges. Website screenshots and generated media retain their original colors. Shadows establish elevation for dialogs and toasts; operational cards use borders. Use 8px control and 12px panel radii. Spacing follows 4/8/12/16/24/32px. Desktop sidebar 224px; shared content grid shrinks and wraps on mobile. Tables keep numeric alignment and bounded history.

## Layout concept

The dashboard opens with the actual bridge: connected website → recorded and verified task → callable API. Real counts and run history follow. The builder moves through choose website/task, demonstrate, define result checks; the API screen exposes the endpoint, input/output contract, execution budget and client examples. Empty states explain one next step. Provider signup, copied session imports and labs do not interrupt the main path.

```text
Navigation | Page title and primary action
           | Website → recorded task → API
           | Real workspace status
           | Run activity and history
```

This preserves the user's dashboard direction while keeping the bridge itself memorable. Avoid a marketing hero on every populated screen, repeated setup calls, invented usage metrics and decorative charts.

## References and applied guidance

Studied Linear's restrained navigation, Trigger's observable execution states, and n8n's readable execution management. Installed UI UX Pro Max, Anthropic Frontend Design and relevant UI Skills guidance. UI UX Pro Max searches inform spacing, process clarity, accessible errors and React implementation; generic catalog landing layouts and palettes that do not fit Hermo were rejected. The explicit project brief takes priority over optional framework migrations.

Reuse React, Lucide, Radix dialogs, existing forms and Motion. Native labels, visible focus, keyboard access, focus restoration, typed-name destructive confirmation, field-linked hints/errors, explicit loading/disabled states and reduced motion are required. Page transitions use only opacity/transform for 160ms; actual data stays immediately readable. Verify at 375, 768, 1440px and short landscape dimensions.

## Alignment refinement — 14 October 2026

The user explicitly replaced the earlier blue accent with black and white. This preference takes priority on all screens, dialogs, consumer apps and companion UI. Action cards group the connection and category on one flexible metadata row with a visible gap. Cards in the same grid row share footer baselines even when titles wrap. Avoid combining child panel margins with grid gaps; keep form help inside one spacing rhythm and preserve consistent content edges.

The project selector uses a full-width native control with the shared 8px radius
and 44px height. Its visible 12px label and management button form one aligned
heading row; preserve the select's accessible name and keyboard behavior. Use
16px between workspace and project groups, 20px before desktop navigation, and
the existing smaller mobile spacing. Long names must not widen the sidebar.

Shared dropdowns reserve 40px for the chevron and inset its icon by 12px; keep
native selection/keyboard behavior and restore the system arrow in forced-colors
mode. Grid panels own their gaps, so child fields must not add bottom margins.
Execution-browser selects use a readable maximum width; action buttons align to
the same content inset. Input-adjacent buttons share the input's grid row rather
than relying on guessed label-height margins. Media results use one card per
asset, explicit loading, native player controls and expandable JSON; never autoplay
or repeat a website action because a preview fails.
