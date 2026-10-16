# Hermo interface refresh

The workspace now uses a white/charcoal visual system, local Inter typography, consistent control heights and spacing, clear page names, and an illustrative workflow-to-API card. Reference: https://antigravity.google/. The illustration is explicitly an example, not a live API or fabricated result.

React Bits CountUp is included as source with its license in `licenses/react-bits.md`. AnimatedContent is adapted to the existing Motion runtime. Both respect reduced-motion settings. Source: https://reactbits.dev/ and https://github.com/DavidHDev/react-bits. No paid Pro assets were purchased or copied. Inter is served locally under the included OFL license; no external font request is required.

The browser canvas owns its operation status. Initial startup uses one labeled indicator; later operations show one compact overlay over an existing preview. Unrelated buttons are disabled rather than all showing spinners. Closed/error states use a static icon and actionable text. Requests from a previous connection cannot replace the current connection's preview. Preview refresh remains manual. Verification and publication also use separate busy states, so publication does not spin during a test.

Analytics loads on demand: the main JavaScript chunk is about 483 KB instead of 846 KB, and the 362 KB chart chunk is fetched only for Overview. The final production build has no large-chunk warning. This is a bundle-size change, not a measured page-load benchmark.

Validation: production build and the ten browser/API end-to-end tests passed. A personal-credential-free UI walkthrough connected the sandbox, recorded an input and two outputs, verified the result, published an API, and opened its documentation. The one-time key was not read or captured. Dashboard/docs were inspected at a 390px viewport without horizontal page overflow. A delayed-start fixture confirmed exactly one browser spinner and no second busy overlay. See `../archive/DESIGN-VALIDATION.json` for scope and limits.

Logo: built-in image generation, transparent PNG, saved as `public/brand/hermo-crab.png`. Used in the sidebar, unlock screen, and favicon. Original generation is preserved in the Codex generated-images directory.

Final image-generation prompt:

> Use case: logo-brand. Create ONE final minimal hermit crab symbol for the software product Hermo. A refined flat ink-black silhouette logo, elegant spiral shell formed by one broad curved shape with clean negative space, two tiny claws and short legs suggesting a hermit crab without cartoon eyes. Premium modern software identity, quiet, geometric but organic, immediately readable at 24 pixels. Transparent background, centered square composition, mark occupying 80 percent of canvas. Solid near-black (#181a1c), no gradient, no shadow, no texture, no text, no wordmark, no frame, no mockup. This is a final usable standalone brand icon, not a page of concepts. Save the generated asset so it can be copied into the Hermo public assets folder.
