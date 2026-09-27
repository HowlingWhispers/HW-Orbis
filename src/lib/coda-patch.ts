/**
 * A Coda draft for a non-world file targets that record's own `document`, so Orbis
 * merges the patch into `document` directly. Models naturally reach for the enclosing
 * asset shape and answer with `{ "document": { ... } }` instead, which would otherwise
 * nest a second `document` inside the first and leave every visible field untouched.
 *
 * Unwrapping is deliberately conservative: only a patch whose single top-level key is
 * `document` is treated as wrapped, so a document that genuinely owns a `document` key
 * keeps merging as before.
 */
export function unwrapDocumentPatch(patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const record = patch as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'document') return patch;
  const inner = record.document;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return patch;
  return inner;
}

/** The Persona document fields a Coda draft is allowed to populate. */
export const PERSONA_DOCUMENT_KEYS = [
  'identity', 'appearance', 'personality', 'background', 'speech', 'preferences', 'skills', 'notes',
] as const;
