# Data and privacy

This describes Hermo's current local operation. It is a draft for legal review,
not a statement of compliance with any particular jurisdiction's privacy law.

## Information handled locally

Hermo stores website connection metadata, workflow definitions, API-key hashes,
execution inputs and results, timestamps and audit-event metadata in the local
workspace. Browser sessions and Google sign-in state are handled only when the
corresponding feature is explicitly authorized. Selected-tab execution uses the
session already present in that Chrome tab; the main companion does not read
cookies. The separate optional Google sign-in companion can transfer approved
Google cookies after password confirmation and explicit consent.

Sensitive payloads are encrypted locally. Names, URLs, IDs, statuses and other
database metadata are not all encrypted. Browser-managed profiles, memory,
screenshots, exports, backups and the operating system have separate security
boundaries. Encryption does not protect against a compromised OS account.
Workflow defaults and results can contain private information; automatic
sensitive-field detection and redaction are incomplete.

## External communication

Workflow actions communicate with the websites you authorize. Those sites
receive the information submitted to them and apply their own privacy policies.
Optional Google workspace sign-in communicates with Google for OAuth and token
verification. External media hosts receive a request when you explicitly load a
preview or open a link. Signed media URLs can themselves grant access to data.

The runtime has no analytics or telemetry service. The GitHub README loads its
technology badges from Shields.io; viewing the repository is separate from
running Hermo. Development dependency installation and explicitly requested
external website checks also contact their respective services.

## Retention, exports and removal

Completed run data expires after the configured 7, 30 or 90 days; audit metadata
expires after 90 days. Workflow definitions and saved connection configuration
persist until removed. Database deletion is logical deletion, not guaranteed
erasure from SQLite pages, journals, backups, OS caches or storage hardware.

Workspace exports are unencrypted downloads and can contain private run inputs
and results. Protect or delete exported files and backups yourself. Removing a
saved sign-in from Hermo does not revoke provider sessions, erase an ordinary
Chrome profile or sign out other devices. Revoke third-party credentials with
the provider when necessary.

Hermo currently offers no cloud session synchronization or hosted execution.
The operator controls the device, access permissions, backups and workflows.
For incident response, see [Security](../SECURITY.md#incident-response).

## Legal review

Before distribution or operation as a service, the owner must determine the
responsible legal entity, applicable jurisdictions, contact details and any
required notices or rights-request process. No such details are invented here.
