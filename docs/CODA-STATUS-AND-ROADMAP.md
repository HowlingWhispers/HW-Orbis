# Coda — Status and Onward Plan

Reconciled against the shared conversation (`6abea2d2-ecec-83ed-8c83-3502eea79c75`,
314 messages) and verified against the actual repositories on 2026-10-01. Nothing below
is taken from either transcript on trust; every "done" item was confirmed in source,
in the database, or on the live Discord guild.

Verification points: `coda @ c1b47e7` (clean tree), `orbis @ 6693aa1..7028a7c` (clean
except untracked planning docs), migrations through `028`, both services active.

---

## 1. Done, and confirmed working

### Room-scoped behavior
- `🐾 CODA` category `1555231119061028995` with `#codas-den` `1555231120654868590`,
  `#coda-office` `1555231121694920784`, `#coda-lab` `1555231122655289396`. All IDs
  pinned in `config/coda-channel-policy.json`; resolution is by snowflake, not name.
- Access modes `ambient` / `mention-only` / `disabled` / `forum-aware`; behavior modes
  `playful` / `balanced` / `focused`; ambient levels; private categories disabled.
- Bug forum `1552809250089345064` (focused) and Idea forum `1552809249074192394`
  (balanced), both resolved by trusted ID. Look-alike forums are rejected.
- Forum initial contributions and restrained follow-ups, posted inside the actual thread.

### Ambient behaviour, in two independent paths
- **Invitation**: an explicit hand-off ("talk about", "your turn", trailing teasing
  emoji) wakes her without being named.
- **Topical continuation**: a short reply sharing salient vocabulary with Coda's last
  message continues the same exchange. This was the "bacon is the baconist" case, which
  scored 0 against a threshold of 3 and was invisible to the invitation path.
- Both are ambient-only. Mention-only still needs a name; disabled stays silent.

### Initiative and expression
- `#coda-lab` is `balanced` + `initiative: high` + `experimental: true`, after `focused`
  was found to read as "short, passive, wait for instructions".
- `RESPONSE LENGTH` (match answer to implied task) and `PROACTIVE EXECUTION` (start when
  the request is already established) as global rules, not lab-only.
- The style guide no longer compresses deliverables: "keep paragraphs short" now governs
  *shape*, not *amount*.
- `MEMORY LANGUAGE DISAMBIGUATION`: "don't save any detail" is read as "don't spare any
  detail", not as a memory command.
- Grounded room claims: she can no longer say she wakes everywhere.
- Emoji density and first-person embodiment asserted in every room, including focused.

### Safety and correctness
- Add-only Discord patch with before/after verification. Two verifier defects fixed: active
  threads were absent from the snapshot entirely, and permitted ids came from a caller flag
  rather than the before-state. Second run is a clean no-op.
- Bug/idea forum lookup by stable ID; slash-created posts contribute in-thread.
- Office delivery re-resolves room policy before posting; `/coda ask|summarize` obey the
  disabled-category gate.
- Authoritative identity, reply, mention and attachment context.
- Office reading (migration `027`): 64 KiB immediate, 64 KiB–2 MiB queued, dedupe, leases,
  scoped retrieval, ephemeral `/coda office`.
- Tests: Coda 58/58. Orbis 522 passed, 11 skipped, 0 failures.

---

## 2. Specified in the shared conversation but **not built**

Verified absent from source. Ordered by dependency, not by enthusiasm.

| # | Item | Status |
|---|---|---|
| A | Durable social memory — `coda.social_context`, `coda.user_preferences` | Schema `coda` created by `028`, but **empty**. No tables. |
| B | Image perception (Coda reads image metadata / "sees" images) | Not started. Generation exists, perception does not. |
| C | `/coda render` with consent dialog, Anlas cost estimate, quality tiers, `settings`, `info` | Not started. |
| D | `#coda-art` (SFW / V5 Curated) and `#coda-art-18` (18+ gate / V5 Full) | Channels do not exist. |
| E | `#coda-profiles` + `/coda profile create\|view\|edit\|clear` | Not started. |
| F | Public changelog entry for the new rooms and modes | **Zero mentions.** Latest entry is still `2026.10.01.1`. |
| G | Changelog expansion (digest, pagination, per-entry reads) | Plan only. |

Two corrections to assumptions in the shared conversation:

1. **Image generation already exists.** `server/coda-discord-image.ts` calls
   `image.novelai.net/ai/generate-image`, and `/coda image scene:` is registered. The gap
   is `/coda render` (the paid-allowance consent path), not generation itself.
2. **`028_coda_schema.sql` grants a schema and nothing else.** It contains no `CREATE
   TABLE`. Anything referring to `coda.social_context` or `coda.user_preferences` as
   existing is describing intent, not state.

---

## 3. Plan

Sequenced so each step is independently shippable and reversible.

### Step 1 — Publish what already shipped (no schema, no risk)
The rooms, modes and initiative work are live and user-visible but absent from the public
changelog, which is the one surface every member sees. Add a new entry to
`server/public-changelog.ts` describing the rooms and what Coda does differently in each.

- Must pass every `tests/changelog.test.ts` sanitization gate. No channel snowflakes, no
  internal vocabulary, no world names, every item ending in a period.
- New version above `2026.10.01.1`. Bump once, not per room.
- Do **not** publish the Lab initiative change as a separate entry; it is invisible to
  members and only interesting as part of the room description.

*Why first:* it is the cheapest correction of a real gap, and it establishes the
`npm run changelog:check` habit before the expansion work makes copy routine.

### Step 2 — Image perception, before `/coda render`
Perception is the capability that makes the art channels meaningful; a render command with
no ability to see what it produced is a novelty.

- Read generation metadata the provider already returns (seed, steps, sampler,
  resolution) and expose it as structured context, clearly labelled as provider metadata
  and never as vision.
- A separate vision path must report its own status honestly (`not-run`, `failed`) rather
  than implying the image was seen.
- Reuse the existing attachment honesty rule: never claim to have read contents that were
  not loaded.
- Migration `029` only if perception state must persist; keep it optional so a failed
  migration degrades rather than blocks.

### Step 3 — `/coda render` with explicit spend consent
The shared conversation's own rule is the requirement here: never silently spend a paid
allowance.

- Two-step confirmation showing prompt, model, quality, resolution, steps and **estimated
  cost before generation**.
- No generation without that confirmation, including from a slash command with options.
- Model routing by room: SFW rooms use the curated model; the 18+ room uses the full model
  and is gated on the existing adult-access decision, never on a channel name.
- A `/coda render settings` and `/coda render info` for the owner, plus an audit record.
- On failure, state the failure. Never imply an image exists that does not.

### Step 4 — Art channels, additively
`#coda-art` and `#coda-art-18` created through the existing `npm run room-patch` path, so
the same snapshot-and-verify guarantees apply and nothing else is touched. This is the one
step that mutates Discord, and it must re-run the verifier rather than trusting the plan.

### Step 5 — Durable social memory
Only now, because it is the only item that creates durable personal data.

- Write the rules before the tables: scope, TTL, provenance, deletion, and when Coda may
  surface a memory unprompted.
- Migration `029` creating `coda.social_context` and `coda.user_preferences`; Coda holds no
  PostgreSQL credential and reaches these only through authenticated Orbis internal APIs.
- Transparent and inspectable by the member. Deletion must be real and verifiable.
- Proactive surfacing must be rate-limited, or the Den turns into a stoner.

### Step 6 — Profiles and per-person context
`#coda-profiles` and `/coda profile` last. It is the most privacy-sensitive surface and
depends on the memory rules from step 5 being settled. Coda gets familiar with people
through scoped, transparent context that the person can see and clear.

### Step 7 — Changelog expansion
As written in `docs/CHANGELOG-EXPANSION-PLAN.md`. Unread backlog first (no schema, fully
reversible), then the authoring split, then per-entry acknowledgement via migration `029`.
Keep published entries in source so a database outage still cannot hide the changelog.

---

## 4. Risks worth carrying

- **The biggest remaining semantic risk is false capability claims.** She already claimed
  she woke everywhere. As she gains image, profile and memory features the surface for
  over-claiming grows with it. Every new capability needs an explicit "what I did not do"
  line in the same commit that adds it.
- **Paid allowance.** Step 3 is the first feature that spends money. Consent must be
  structural, not prompt-level.
- **Migration numbering.** `025` is already used twice. Verify the next free number before
  creating `029`, and apply by hand with `psql -f` in order.
- **Ambient tuning.** Adjacency is last-2-messages and continuation caps at 250 characters.
  Both are deliberately conservative and are the first knobs to loosen if the Den still
  feels quiet — but loosen them with the watch on spam, not in isolation.

## 5. Definition of done, every step

- `npm test`, `npm run lint`, `npm run build` clean in both repos
- Coda 58/58 (or higher) and Orbis 522 passed / 11 skipped / 0 failures maintained
- `dist-server/` built **and `orbis.service` restarted**, then endpoints verified directly
- Any Discord change re-verified: 0 channels lost, 0 threads lost, 0 roles or permission
  overwrites changed
- Both trees clean and committed