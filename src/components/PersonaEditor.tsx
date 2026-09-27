import { Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { libraryApi } from '../api/client';
import type { ContentRating, LibraryAsset, LibraryAssetUpdate } from '../types/library';

type JsonRecord = Record<string, unknown>;
type PersonaVisibility = 'private' | 'unlisted' | 'public';

const protectedDraftKeys = new Set([
  'id', 'sourceId', 'libraryAssetId', 'worldSettings', 'personaSettings', 'creatorUserId', 'ownerUserId',
  'contentRating', 'permissions', 'providerSettings', 'token', 'apiKey', 'secret', 'visibility', 'showInLibrary', 'allowUse', 'allowForking',
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asLines(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mergeCodaDraft(current: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return patch;
  if (!patch || typeof patch !== 'object') return patch;
  const currentRecord = asRecord(current);
  const next: JsonRecord = { ...currentRecord };
  for (const [key, value] of Object.entries(patch as JsonRecord)) {
    if (protectedDraftKeys.has(key)) continue;
    next[key] = mergeCodaDraft(currentRecord[key], value);
  }
  return next;
}

export function PersonaEditor({ asset }: { asset: LibraryAsset }) {
  const navigate = useNavigate();
  const [name, setName] = useState(asset.name);
  const [summary, setSummary] = useState(asset.summary);
  const [contentRating, setContentRating] = useState<ContentRating>(asset.contentRating ?? 'sfw');
  const [tags, setTags] = useState(asset.tags.join('\n'));
  const [visualTone, setVisualTone] = useState<LibraryAsset['visualTone']>(asset.visualTone);
  const [document, setDocument] = useState<JsonRecord>(() => structuredClone(asset.document ?? {}));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const identity = asRecord(document.identity);
  const settings = asRecord(document.personaSettings);
  const visibility: PersonaVisibility = settings.visibility === 'public' || settings.visibility === 'unlisted' ? settings.visibility : 'private';

  const change = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setDirty(true);
    setMessage('');
  };

  const changeDocument = (key: string, value: unknown) => {
    setDocument((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setMessage('');
  };

  const changeIdentity = (key: string, value: string) => changeDocument('identity', { ...identity, [key]: value });
  const changeSettings = (patch: JsonRecord) => changeDocument('personaSettings', { ...settings, ...patch });

  const payload = useMemo<LibraryAssetUpdate>(() => ({
    name: name.trim(),
    summary: summary.trim(),
    contentRating,
    tags: tags.split('\n').map((tag) => tag.trim()).filter(Boolean),
    visualTone,
    document,
  }), [name, summary, contentRating, tags, visualTone, document]);

  const save = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!payload.name) return setMessage('Persona name is required.');
    setSaving(true);
    setMessage('');
    try {
      await libraryApi.updateAsset(asset.id, payload);
      setDirty(false);
      setMessage('Persona saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The Persona could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [asset.id, payload]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', shortcut);
    };
  }, [dirty, save]);

  useEffect(() => {
    const applyCodaDraft = (event: Event) => {
      const detail = (event as CustomEvent<{ assetId?: string; patch?: unknown }>).detail;
      if (detail?.assetId !== asset.id || !detail.patch || typeof detail.patch !== 'object' || Array.isArray(detail.patch)) return;
      setDocument((current) => mergeCodaDraft(current, detail.patch) as JsonRecord);
      setDirty(true);
      setMessage('Coda draft applied locally. Sharing settings were left untouched. Review before saving.');
    };
    window.addEventListener('orbis:coda-apply-draft', applyCodaDraft);
    return () => window.removeEventListener('orbis:coda-apply-draft', applyCodaDraft);
  }, [asset.id]);

  return <form className="record-editor" onSubmit={save}>
    <header className="editor-header">
      <div><span className="eyebrow">Persona editor</span><h1>{asset.name}</h1><p>A reusable player identity. World and simulation state are stored separately from this Persona.</p></div>
      <div className="editor-header__actions">
        <span className={dirty ? 'editor-dirty is-dirty' : 'editor-dirty'}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button className="button button--secondary" type="button" onClick={() => navigate(`/asset/${asset.id}`)}>Cancel</button>
        <button className="button button--primary" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save Persona'}</button>
      </div>
    </header>

    <div className="editor-layout">
      <section className="editor-panel">
        <h2>Library card</h2>
        <div className="editor-grid">
          <label className="editor-field"><span>Name</span><input value={name} maxLength={120} onChange={(event) => change(setName, event.target.value)} /></label>
          <label className="editor-field editor-field--wide"><span>Summary</span><textarea rows={4} maxLength={2000} value={summary} onChange={(event) => change(setSummary, event.target.value)} /></label>
          <label className="editor-field"><span>Content rating</span><select value={contentRating} onChange={(event) => change(setContentRating, event.target.value as ContentRating)}><option value="sfw">SFW</option><option value="adult">Adult</option></select></label>
          <label className="editor-field"><span>Visual tone</span><select value={visualTone} onChange={(event) => change(setVisualTone, event.target.value as LibraryAsset['visualTone'])}>{['moon','forest','ember','mist','violet','river'].map((tone) => <option value={tone} key={tone}>{tone}</option>)}</select></label>
          <label className="editor-field editor-field--wide"><span>Tags</span><textarea rows={4} value={tags} onChange={(event) => change(setTags, event.target.value)} /><small>One tag per line</small></label>
        </div>
      </section>

      <section className="editor-panel">
        <h2>Persona</h2>
        <p className="editor-panel__intro">These fields describe who the player is. Inventory, location, money, relationships and progression belong to a world/session instance instead.</p>
        <div className="editor-grid">
          <label className="editor-field"><span>Display name</span><input value={asText(identity.displayName)} onChange={(event) => changeIdentity('displayName', event.target.value)} /></label>
          <label className="editor-field"><span>Species</span><input value={asText(identity.species)} onChange={(event) => changeIdentity('species', event.target.value)} /></label>
          <label className="editor-field"><span>Age / age description</span><input value={asText(identity.age)} onChange={(event) => changeIdentity('age', event.target.value)} /></label>
          <label className="editor-field"><span>Pronouns</span><input value={asText(identity.pronouns)} onChange={(event) => changeIdentity('pronouns', event.target.value)} /></label>
          <label className="editor-field editor-field--wide"><span>Identity description</span><textarea rows={4} value={asText(identity.description)} onChange={(event) => changeIdentity('description', event.target.value)} /></label>
          <label className="editor-field editor-field--wide"><span>Appearance</span><textarea rows={5} value={asText(document.appearance)} onChange={(event) => changeDocument('appearance', event.target.value)} /></label>
          <label className="editor-field editor-field--wide"><span>Personality</span><textarea rows={5} value={asText(document.personality)} onChange={(event) => changeDocument('personality', event.target.value)} /></label>
          <label className="editor-field editor-field--wide"><span>Background</span><textarea rows={5} value={asText(document.background)} onChange={(event) => changeDocument('background', event.target.value)} /></label>
          <label className="editor-field editor-field--wide"><span>Speech / voice</span><textarea rows={4} value={asText(document.speech)} onChange={(event) => changeDocument('speech', event.target.value)} /></label>
          <label className="editor-field"><span>Preferences</span><textarea rows={5} value={asLines(document.preferences).join('\n')} onChange={(event) => changeDocument('preferences', event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} /><small>One per line</small></label>
          <label className="editor-field"><span>Skills</span><textarea rows={5} value={asLines(document.skills).join('\n')} onChange={(event) => changeDocument('skills', event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} /><small>One per line</small></label>
          <label className="editor-field editor-field--wide"><span>Notes</span><textarea rows={4} value={asText(document.notes)} onChange={(event) => changeDocument('notes', event.target.value)} /></label>
        </div>
      </section>

      <section className="editor-panel">
        <h2>Sharing</h2>
        <p className="editor-panel__intro">Only you control these settings. Coda can edit the Persona, but she cannot make it public or change reuse permissions.</p>
        <div className="editor-grid">
          <label className="editor-field"><span>Visibility</span><select value={visibility} onChange={(event) => {
            const next = event.target.value as PersonaVisibility;
            changeSettings({ visibility: next, ...(next === 'public' ? {} : { showInLibrary: false }) });
          }}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
          <label className="editor-toggle"><input type="checkbox" checked={visibility === 'public' && settings.showInLibrary === true} disabled={visibility !== 'public'} onChange={(event) => changeSettings({ showInLibrary: event.target.checked })} /><span>Show in public Persona library</span></label>
          <label className="editor-toggle"><input type="checkbox" checked={settings.allowUse === true} onChange={(event) => changeSettings({ allowUse: event.target.checked })} /><span>Allow other users to use this Persona</span></label>
          <label className="editor-toggle"><input type="checkbox" checked={settings.allowForking === true} onChange={(event) => changeSettings({ allowForking: event.target.checked })} /><span>Allow copy / remix</span></label>
        </div>
      </section>
    </div>

    <footer className="editor-footer"><span role="status">{message}</span><small>Tip: press Ctrl+S to save.</small></footer>
  </form>;
}
