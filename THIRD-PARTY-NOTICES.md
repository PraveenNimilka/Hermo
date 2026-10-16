# Third-party notices

Hermo-authored source is licensed under [MIT](LICENSE). The following included
code and assets retain their original terms. These notices do not relicense
third-party material.

## React Bits adaptations

- Files: `src/components/AnimatedContent.tsx` and
  `src/components/react-bits/CountUp.tsx`.
- Copyright: David Haz, 2026, as retained in the included notices.
- Sources: [React Bits](https://reactbits.dev/),
  [AnimatedContent](https://reactbits.dev/animations/animated-content),
  [repository](https://github.com/DavidHDev/react-bits).
- Included terms: [MIT + Commons Clause License Condition v1.0](licenses/react-bits.md).

The components are adapted and used within the Hermo application. Their included
terms permit application/product use but restrict selling, sublicensing or
redistributing the components themselves, whether alone, bundled or ported.
Hermo's MIT license does not remove those conditions. Keep their source notices
and the included license when redistributing applicable material.

## Inter font

- File: `public/fonts/InterVariable.woff2`.
- Copyright: The Inter Project Authors, 2016, as retained in the included notice.
- Source: [Inter](https://github.com/rsms/inter).
- License: [SIL Open Font License 1.1](licenses/inter.txt).

The font is served locally. Its included OFL terms govern redistribution and
modification; the project source license does not replace them.

## Other dependencies and development tools

npm dependencies retain their upstream licenses and notices. The exact resolved
versions are recorded in `package-lock.json`; consult their installed package
metadata when distributing an application bundle.

Downloaded coding-agent skill packages under `.agents/` are local development
tools and are excluded from this repository. Design guidance sources are
[UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill),
[Anthropic Frontend Design](https://github.com/anthropics/skills/tree/main/skills/frontend-design),
and [UI Skills](https://github.com/ibelick/ui-skills). Install and use them under
their own current instructions and terms; they are not required at runtime.
