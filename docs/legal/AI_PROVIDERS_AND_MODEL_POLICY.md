# AI Providers and Model Policy

Status: service policy draft
Applies to: Speculus, Fabula and any Howling Whispers feature that can send prompts or context to an AI model
Last updated: 6 September 2026

## 1. Purpose

The Howling Whispers may support more than one AI provider, model vendor, gateway, or user-supplied local model.

Different models have different strengths, weaknesses, moderation behavior, privacy characteristics, context limits, costs, and acceptable-use rules.

No provider is guaranteed to remain available permanently, and support for a provider does not mean that The Howling Whispers controls that provider's model behavior or policies.

Users must comply with the current terms, acceptable-use rules, age requirements, and other restrictions of the provider they choose to use.

Where a provider's current rules conflict with a feature, prompt, world, character, or requested scene, the provider's rules control what that provider may generate.

The summaries below are practical guidance only. Provider policies can change and the provider's current published terms always take priority over this document.

---

## 2. Provider choice

Where model selection is available, users may be able to choose between supported providers or connect a compatible personal endpoint.

The Howling Whispers may expose information such as:

- provider name;
- model name;
- whether the model is remote or local;
- expected strengths;
- known limitations;
- whether the provider applies external moderation or filtering;
- context-window or memory limitations;
- approximate cost where applicable; and
- whether the connection uses a platform-managed credential or the user's own credential.

A model being available does not mean it is appropriate for every scene.

---

## 3. NovelAI

### Typical strengths

NovelAI is expected to be one of the strongest choices for free-form fiction and roleplay in The Howling Whispers.

Depending on the model and configuration, it may be particularly suitable for:

- character voice;
- long-form narrative prose;
- improvisational roleplay;
- less rigid conversational structure;
- maintaining tone and style; and
- adult-oriented fictional writing where permitted by NovelAI's own rules.

### Important limitations and risks

NovelAI can be comparatively willing to continue the tone or direction implied by the prompt and context. This is useful for roleplay, but it also means that a model may generate content that the user did not specifically request or expect.

Possible unwanted output may include:

- sexual or explicit material;
- graphic violence;
- disturbing themes;
- offensive language;
- escalation of a scene beyond the user's intended tone; or
- invented details that conflict with canon.

Users should therefore treat generated text as model output rather than guaranteed authored canon.

The Howling Whispers may provide controls, prompt guidance, regeneration, stop controls, content preferences, or scene settings, but no control can guarantee that a generative model will never produce an unexpected result.

NovelAI usage remains subject to NovelAI's own current terms, account rules, model rules, and applicable law.

---

## 4. OpenAI models

### Typical strengths

OpenAI models may be useful for:

- instruction following;
- structured character and world analysis;
- summarization;
- continuity checks;
- tool-assisted workflows;
- reasoning about world state; and
- general-purpose conversational roleplay.

### Important limitations and risks

OpenAI services apply their own safety and usage requirements. Some fictional, sexual, violent, exploitative, illegal, or otherwise restricted requests may be refused, transformed, limited, or answered differently from a more permissive fiction-focused model.

This means a scene that works with another provider may not work in the same way with an OpenAI model.

The Howling Whispers must not attempt to present provider refusal behavior as a defect in the user's character or world. It is a limitation or policy boundary of the selected provider.

Use of OpenAI models is subject to OpenAI's current applicable terms and policies.

---

## 5. Anthropic models

### Typical strengths

Anthropic models may be useful for:

- long-context interpretation;
- coherent prose;
- character and lore analysis;
- summarization;
- continuity work; and
- structured reasoning over large world records.

### Important limitations and risks

Anthropic applies its own safety and acceptable-use requirements. Some roleplay scenarios or forms of sexual, violent, abusive, exploitative, or otherwise restricted content may be refused or constrained.

A user should not assume that because a scene is permitted by The Howling Whispers world rules it will necessarily be accepted by Anthropic.

Use of Anthropic models is subject to Anthropic's current applicable terms and policies.

---

## 6. Google Gemini models

### Typical strengths

Gemini models may be useful for:

- general conversation;
- structured reasoning;
- summarization;
- large-context tasks where supported;
- multimodal workflows where supported; and
- world or character analysis.

### Important limitations and risks

Google applies its own service, safety, account, and acceptable-use requirements. Some roleplay content may be filtered, refused, altered, or unavailable depending on the model, account, region, and service configuration.

Use of Gemini is subject to Google's current applicable terms and policies.

---

## 7. Mistral models and Mistral-compatible deployments

### Typical strengths

Mistral-family models may be useful for:

- fast general-purpose generation;
- roleplay;
- lower-cost inference depending on provider;
- self-hosted or private deployment where the applicable model license permits it; and
- OpenAI-compatible API workflows depending on the deployment.

### Important limitations and risks

Behavior can differ substantially between Mistral's own hosted services, third-party hosts, fine-tuned models, and locally deployed Mistral-family models.

Moderation, logging, privacy, content restrictions, and rate limits may therefore depend on the actual host rather than only the model family.

Users must comply with both the model license and the rules of the service hosting the model.

---

## 8. Third-party gateways and aggregators

The Howling Whispers may support third-party gateways that provide access to one or more underlying models.

A gateway may impose its own:

- acceptable-use rules;
- content restrictions;
- logging practices;
- pricing;
- rate limits;
- model substitutions;
- data-retention terms; and
- account restrictions.

The underlying model provider may also impose separate terms.

Users should therefore understand that using a gateway can create more than one applicable policy layer.

The Howling Whispers may disable a gateway or model if its terms become incompatible with the service, if the integration becomes unreliable, or if continued support would create unacceptable security, privacy, legal, or operational risk.

---

## 9. Personal local models

Users may be allowed to connect a model running on their own computer, local network, or personally controlled server, including compatible Ollama, llama.cpp, vLLM, OpenAI-compatible, or similar endpoints.

### Typical strengths

Local models may provide:

- greater privacy when all inference remains on hardware controlled by the user;
- no per-message third-party API charge;
- greater control over model choice and fine-tuning;
- fewer provider-side interruptions;
- custom roleplay behavior; and
- offline or LAN-only operation where the surrounding application supports it.

### Important limitations and risks

A local model may have little or no external moderation and can therefore produce material that a hosted provider would refuse.

The user is responsible for the local model they select and operate, including:

- complying with the model's license;
- complying with applicable law;
- securing the model endpoint;
- deciding whether the endpoint is exposed to the public internet;
- protecting API keys or authentication tokens if used;
- understanding any logging performed by their inference software;
- providing sufficient hardware and system resources; and
- accepting that output quality, safety, memory behavior, and reliability vary by model.

The Howling Whispers does not become the operator or publisher of a user's local model merely because the software can connect to it.

A user must not expose an unauthenticated local model endpoint to the public internet through The Howling Whispers configuration unless they understand and accept the security risk.

---

## 10. User-supplied remote endpoints

A user may be able to configure a personally controlled or third-party remote API endpoint.

The Howling Whispers cannot guarantee the privacy, security, uptime, model identity, logging behavior, or policy compliance of an endpoint supplied by the user.

The user is responsible for verifying the operator of that endpoint and determining whether they are comfortable sending roleplay prompts, character data, world context, persona data, or other information to it.

The service should clearly identify when content is about to be sent to a user-configured external endpoint where practical.

---

## 11. Model output is not guaranteed canon

All supported models are probabilistic systems.

A model may:

- hallucinate facts;
- contradict a character card;
- forget world rules;
- merge characters incorrectly;
- invent relationships;
- reveal information a character should not know;
- produce unwanted explicit or disturbing material;
- repeat itself;
- refuse a permitted fictional scene because of provider rules; or
- behave differently after a provider updates the model.

The Howling Whispers may use context compilation, memory systems, validation, canon records, rerolls, diagnostics, and other controls to reduce these problems, but it cannot promise perfect output from any generative model.

Persistent Fabula world state should not automatically treat every generated sentence as canonical world truth. Canon-changing events should be committed according to the applicable world and runtime rules.

---

## 12. Content preferences and unexpected output

Users should be given reasonable controls over the type of experience they want where technically practical.

However, generative models can produce unexpected content even when a user has selected preferences intended to avoid it.

Users may stop generation, regenerate, change provider, change model, leave the scene, or adjust available preferences when a result is unwanted.

The presence of a model capable of generating mature content does not mean that every user has requested or consented to receive such content.

Multiplayer participants must not use a model to force private generated content into another user's shared scene outside the permissions and consent model of that scene.

---

## 13. Provider outages, changes, and removals

A provider may change its:

- model lineup;
- API format;
- pricing;
- context limits;
- moderation behavior;
- acceptable-use rules;
- geographic availability; or
- service availability.

The Howling Whispers may therefore add, remove, disable, rename, or replace integrations without guaranteeing permanent availability of any particular provider or model.

Saved characters, worlds, personas, and sessions should remain provider-independent where technically practical so that users can move between compatible models without losing authored content.

---

## 14. Credentials and billing

Where users supply their own provider credentials, those credentials remain associated with the user's chosen provider account.

The user is responsible for charges incurred through their own provider account.

The Howling Whispers should not intentionally expose provider API keys to other users.

Where The Howling Whispers operates a shared provider account or paid inference service, separate quotas, subscriptions, usage limits, or billing terms may apply.

---

## 15. No universal model rules

The Howling Whispers does not impose one fictional-content policy on every AI provider in a way that falsely promises identical behavior.

Instead:

```text
The Howling Whispers rules
+ the selected world's authored rules
+ the selected model/provider's current rules
+ applicable law
= the effective boundaries of that session
```

A local model may have very different technical restrictions from a hosted commercial model, but local operation does not remove the user's responsibility to comply with law, licenses, multiplayer rules, and the rights of other users.

---

## 16. Provider summaries are not warranties

Descriptions such as "good for roleplay", "strong at reasoning", "more permissive", "more private", or "lower cost" are practical guidance, not warranties.

Model quality and behavior can change between versions, quantizations, fine-tunes, providers, prompts, and runtime settings.
