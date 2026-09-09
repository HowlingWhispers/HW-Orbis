# Legal Launch Checklist

Status: implementation checklist
Last updated: 6 September 2026

This is the practical checklist for turning the legal drafts into a real production legal package.

## Must be completed before public commercial launch

- Fill in the real operator identity, address and contact details in `LEGAL_NOTICE_IMPRINT.md`.
- Confirm the operator's country of establishment and business/legal form.
- Add VAT, register and supervisory-authority details if applicable.
- Add the real privacy, legal, billing, moderation and security contact addresses.
- Confirm whether a data-protection officer is legally required.
- Inventory all personal data processed by Orbis/Coda, Speculus and Fabula.
- Record the legal basis and exact retention period for each data category.
- Inventory every cookie, localStorage key and third-party browser technology.
- Confirm which browser storage is strictly necessary and which requires consent.
- Add a consent UI before any optional tracking that legally requires consent.
- Confirm all AI providers currently offered and link to their current terms/privacy policies in the production UI where appropriate.
- Confirm which providers receive prompts, memories, world context or personal data.
- Review international data transfers and contractual safeguards where required.
- Confirm the Discord OAuth scopes actually requested and document their purposes.
- Confirm how Discord-server membership is checked for Fabula multiplayer.
- Implement a user-friendly illegal-content/report mechanism.
- Implement a moderation appeal route where appropriate.
- Publish a contact point for users and a legal contact point for authorities where required.
- Implement account deletion and content deletion flows.
- Implement export/backup controls for persistent user-authored data where offered.
- Implement evidence/legal-hold preservation separately from ordinary content visibility.
- Define exact security-log and moderation-log retention periods.
- Choose the payment provider before charging users.
- Show total price, taxes where applicable, renewal period and cancellation rules before purchase.
- Implement the correct EU/EEA withdrawal flow for the legal type of paid multiplayer service.
- Never rely on hidden text or a pre-ticked box for withdrawal-right consent.
- Provide any required withdrawal information and model form to consumers.
- Ensure cancellation of recurring billing is reasonably accessible.
- Confirm age requirements for accounts, adult content and paid multiplayer.
- Implement age/role gating where the service promises it.
- Confirm community rules and Discord rules are consistent.
- Confirm copyright/rights reporting and appeal procedures.
- Add visible links to Terms, Privacy, Legal Notice/Impressum and relevant policies from the production site.
- Keep version dates and an archive of material legal changes.

## Strongly recommended

- Have a German/EU-qualified lawyer review the final public versions before charging users.
- Have a privacy professional review the GDPR data map and provider transfers.
- Keep a written incident-response procedure for security breaches and account compromise.
- Keep an internal law-enforcement request procedure so staff do not disclose data merely because someone asks informally.
- Keep a list of who has administrative access to production user data.
- Use a payment processor so The Howling Whispers does not store full card details.
- Minimize logging of private roleplay unless needed for a specific feature, security or user-requested persistence.

## Important

These repository documents are intentionally written in clear language and are useful product/legal drafts, but they do not replace jurisdiction-specific professional advice.

A contract can allocate responsibility between the service and users, but it cannot waive obligations that mandatory law places on the service itself.
