# Cookies and Local Storage Policy

Status: legal draft for review
Applies to: The Howling Whispers websites and web applications
Last updated: 6 September 2026

## Plain-language summary

We prefer to keep browser storage simple.

Some storage is necessary for things such as keeping you signed in, remembering your language or theme and protecting sessions. Optional analytics or advertising storage should not be enabled without the consent required by applicable law.

## 1. What we may store

The service may use cookies, localStorage, sessionStorage or similar browser technologies for purposes such as:

- authentication and session security;
- CSRF and anti-abuse protection;
- remembering language;
- remembering dark, light or automatic theme preference;
- remembering accessibility or interface settings;
- temporary guest-session state where appropriate; and
- other functions strictly necessary to provide a feature requested by the user.

## 2. Necessary storage

Storage that is technically necessary to provide a requested service may be used without optional tracking consent where applicable law permits.

Examples may include authentication/session cookies and a saved theme preference.

## 3. Optional analytics or marketing

If The Howling Whispers later introduces non-essential analytics, advertising, behavioural tracking or similar technologies, the service should obtain any legally required consent before activating them.

Optional categories should not be disguised as necessary storage.

## 4. Third parties

Discord, payment processors, AI providers or embedded third-party services may use their own cookies or similar technologies when a user interacts with them.

Their own policies may apply.

The Howling Whispers should avoid unnecessary third-party embeds on pages where a simple link or server-side integration can achieve the same purpose with less tracking.

## 5. Managing storage

Users can normally remove browser cookies and local storage through their browser settings.

Removing necessary storage may sign the user out, reset preferences or cause some functionality to stop working until the required state is created again.

## 6. Cookie banner

A consent banner should be shown only where needed for technologies that require consent.

The banner should:

- use clear language;
- avoid pre-selected optional consent;
- make rejection reasonably as easy as acceptance;
- allow users to change their choice later; and
- not falsely label optional tracking as necessary.

## 7. Production inventory

Before launch, maintain a real inventory of browser storage used by the application, including:

```text
Name
Type
Purpose
Provider
Expiry / retention
Necessary or optional
```

This policy should be updated when new tracking or storage technologies are introduced.
