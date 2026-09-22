# Orbis to Speculus bridge

Orbis is the launch authority and credential boundary for Speculus. A user opens a Library record and selects **Simulate**. Orbis snapshots the selected record, related world context, the current Orbis identity as the fallback persona, and a short-lived generation grant. It deposits a V3 package into Speculus over the private `/api/v3/launch` bridge and redirects the browser to the returned one-time root URL.

## Credential boundary

- Users enter NovelAI tokens only in Orbis Account settings.
- Orbis encrypts tokens with AES-256-GCM using `ORBIS_CREDENTIAL_ENCRYPTION_KEY`.
- The API returns only configured status, model, and update time.
- Speculus receives an opaque grant scoped to one launch, asset ID, asset revision, model, and expiry.
- The Speculus browser never receives the grant. Speculus seals it in its HTTP-only server session.
- Only Orbis decrypts the token, immediately before its server-side request to NovelAI.
- Ollama and direct provider URLs are not part of this bridge.

## SPC registry contract

Orbis is the only authority allowed to issue permanent Speculus catalogue identities.

Public designations use a Norwegian registration-plate style namespace:

```text
SPC-C-KD41827
SPC-T-AR09153
SPC-W-BX80314
```

The first letter after `SPC-` is the asset class. The final seven characters are a randomly assigned plate made from two letters and five digits. The plate is not derived from the asset UUID and does not expose creation order.

Current class prefixes are:

- `C` Character
- `T` Town / settlement
- `W` World
- `P` Place
- `B` Building / structure
- `I` Item
- `F` Faction
- `S` Species
- `G` Society
- `H` Family / household
- `M` Memory / event
- `X` Other

Every issued SPC record also stores two immutable hidden chronological identities:

- a global registry sequence across every SPC record
- a class registry sequence within its own asset class

The original asset creation timestamp is preserved in the registry as well. These internal values are sent to Speculus as runtime metadata so identity, relationship, and memory systems can continue referring to the same authored entity even after display-name or alias changes.

Rules:

- Public plates are random.
- `AA68696` is permanently reserved and must never be automatically issued.
- An issued SPC designation is never reassigned to another asset.
- Deleting an asset retires its registry entry instead of freeing the designation.
- Archived, retired, and sealed entries continue occupying their registry identity.
- If one complete plate namespace is ever exhausted, the next namespace is prefixed with a generation marker such as `SPC#2-C-KD41827` rather than recycling generation 1 identifiers.
- Speculus validates the identity supplied by Orbis but never creates a new authoritative SPC identity itself.

The migrations preserve Ragna and Pip as the first and second hidden Character-class sequence records when those seeded Bitterroot characters are present. Their public SPC plates remain random.

## Production installation

Apply migrations in order, including:

```bash
psql "$DATABASE_URL" -f server/migrations/004_speculus_bridge.sql
psql "$DATABASE_URL" -f server/migrations/005_speculus_catalog_registry.sql
psql "$DATABASE_URL" -f server/migrations/006_random_speculus_registry.sql
```

Generate independent secrets. Do not reuse the session secret:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Set these in `/etc/howlingwhispers/orbis.env`:

```env
ORBIS_CREDENTIAL_ENCRYPTION_KEY=<base64 output, exactly 32 decoded bytes>
SPECULUS_BRIDGE_URL=http://127.0.0.1:8790
SPECULUS_BRIDGE_SECRET=<shared hex output>
SPECULUS_LAUNCH_TTL_SECONDS=14400
```

Set the same bridge secret in the protected Speculus environment. Build Speculus with its deployment date:

```env
SPECULUS_PUBLIC_ORIGIN=https://spec.thehowlingwhispers.com
SPECULUS_BRIDGE_SECRET=<same shared hex output>
ORBIS_GENERATION_API_URL=http://127.0.0.1:8789/api/v1/generation/speculus
SPECULUS_UPDATE_DATE=<YYYY-MM-DD deployment date>
```

The public domain now opens the V3 boot/recovery surface. A direct visit still cannot generate without a fresh one-time Orbis launch authorization.

## Launch package content

The primary record is immutable for the lifetime of the launch and carries its `updated_at` value as the source revision. Its canonical SPC registry identity is packaged separately from its editable display fields. A world launch includes its children. A child-record launch includes its origin world and accessible sibling records. Related adult records remain excluded unless the launching user has adult access or owns the related record.

Character records are adapted to Character Card V2 fields when matching structured fields exist. Other record types run through Speculus's narrator subject. Until Orbis has a dedicated persona model, the signed-in user's display name is sent as a minimal anti-impersonation persona.
# Speculus V3 primary runtime

Orbis no longer exposes a per-user engine selector. Every **Simulate** action now
targets Speculus V3.

| Runtime | Status | Deposit endpoint | Browser path |
| --- | --- | --- | --- |
| V3 | Primary | `/api/v3/launch` | `/` |
| V2 | Frozen legacy | Not used by Orbis | `/v2` |
| V1 | Frozen legacy | Not used by Orbis | `/v1` |

The old simulation-engine preference table and migrations remain historical
database artifacts, but the selector API and account UI are retired. Existing V1
and V2 code in HW-Speculus is preserved only for deliberate legacy recovery or
comparison and is not part of the normal Orbis launch path.

V3 now has its own package identity (`version: 3, engine: "v3"`), launch cookie,
generation route, and research route. Orbis must not rewrite V2 launch URLs into
V3 or silently fall back to a legacy runtime.

The provider model continues to come from the existing Orbis NovelAI settings;
raw credentials never leave Orbis.
## Generation failures

The generation bridge returns a static, safe error message plus a `NOVELAI_*`
code and an Orbis-generated UUID `requestId` (also in `x-request-id`). When
available it includes `upstreamStatus`, a known rejected `parameter`, the
`requestedMaxTokens`, and a known `finishReason` for an empty reply. A matching
`Speculus generation failed` warning in Orbis logs contains only these fields.
Provider response bodies, tokens, prompts and scene records are never included.

The categories distinguish authentication/access, invalid settings or context,
model availability, rate limits, service/network failure, timeout, unreadable
responses, and empty completions. HTTP 200 with empty text is distinct from a
provider HTTP rejection. Failures are not automatically retried and do not
increment the successful grant-use count. The NovelAI request format and saved
generation settings are unchanged by this error-handling patch.

Deploy/restart both matching APIs to expose these diagnostics in Speculus. No
database migration or session reset is needed. Speculus also recognizes the
previous Orbis version's static errors, so it can be deployed first. This patch
fixes the loss of error details; it does not establish which upstream failure
caused the originally reported generic 502. After deployment, record the displayed
error/request ID from one failed attempt and match it to Orbis logs before
changing credentials, output limits, stop sequences or provider configuration.


## V3 contribution toward Fabula

Speculus V3 is an experimental runtime used to develop and prove systems that can later contribute to Fabula. It is not the official Fabula implementation or product design, and there is no assumption that V3 will simply be renamed into Fabula. Fabula's architecture, interface and theme will be designed separately later.

The World Brain boundary is documented in `SIMULATION_AUTHORING_ARCHITECTURE.md`: Orbis authors, versions and selects the effective brain, while V3 executes the pinned revision against mutable runtime state. That contract is intentionally designed so a future Fabula implementation can reuse or adapt it.
