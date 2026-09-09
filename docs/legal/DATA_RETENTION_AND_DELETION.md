# Data Retention and Deletion Policy

Status: operational and privacy draft
Applies to: The Howling Whispers services
Last updated: 6 September 2026

## Plain-language summary

We should not keep everything forever.

Different information has different purposes, so it should have different retention periods.

## 1. Guest Speculus data

Guest Speculus sessions are intended to be ephemeral.

Guest roleplay history, persistent memory, persona progress and session state should not be retained as permanent account data.

Short-lived technical processing may still occur for delivery, abuse prevention, crash recovery or security.

## 2. Registered account data

Account information may be retained while the account is active and for a limited period after closure where reasonably necessary for recovery, fraud prevention, legal claims, backups or legal obligations.

## 3. Saved roleplay and memory

Persistent roleplay, memory and related state should be retained until the user deletes it, the account is deleted, a configured retention rule expires, or another lawful reason requires removal or preservation.

Users should be given clear controls for deleting persistent content where technically possible.

## 4. Multiplayer presence

Transient presence such as 'currently in this location' should not become permanent history by default.

Where historical location data is needed for moderation, shared-scene continuity or security, it should be limited to what is reasonably necessary.

## 5. Security logs

Security logs may include IP addresses, session identifiers, failed login attempts, abuse events and related technical records.

These should be retained for a limited period suitable for detecting attacks, investigating compromise and defending the service.

## 6. Moderation and evidence

Moderation reports, enforcement decisions and evidence may be retained longer than ordinary session data where reasonably necessary for:

- appeals;
- repeat-abuse detection;
- fraud or ban evasion;
- legal claims;
- legal preservation requests; or
- serious safety investigations.

## 7. Billing records

Invoices, transaction references, tax records and other accounting information may need to be retained for the period required by applicable tax and accounting law.

A user account deletion request does not automatically override mandatory accounting retention.

## 8. Backups

Deleted data may persist temporarily in encrypted or access-restricted backups until those backups rotate or expire.

Backups should not be used to silently restore user-deleted content into active service except where necessary for disaster recovery and consistent with applicable law.

## 9. Legal hold

Deletion may be delayed for specific records where preservation is reasonably necessary to comply with a valid legal request or to establish, exercise or defend legal claims.

Legal holds should be scoped to the information actually needed.

## 10. Production retention schedule

Before launch, maintain an internal table containing exact retention periods for at least:

```text
Account profile
Authentication/session records
Guest-session technical data
Saved RP/session data
Persistent memory
Multiplayer presence logs
Moderation reports
Security logs
Support messages
Billing/tax records
Backups
Legal holds
```

Exact periods should be based on necessity and applicable law rather than convenience.
