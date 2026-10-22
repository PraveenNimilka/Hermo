# Hermo companion

The main companion connects one explicitly authorized Chrome tab to your local
Hermo workspace. It records and replays workflows in that tab, using its existing
website sign-in without copying cookies or passwords.

Load the [`browser`](browser/README.md) directory as an unpacked extension. Keep
that installed folder in place when updating so Chrome retains the companion's
saved browser identity. Follow the [setup guide](../public/connected-browser.html)
for pairing, preview sharing and connection controls.

The optional [Google session import integration](../integrations/google-session-extension/README.md)
is separate. It transfers approved Google cookies for isolated-browser sign-in;
it is not needed for normal connected-tab workflows.
