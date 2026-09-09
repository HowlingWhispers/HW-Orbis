import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { libraryApi } from '../api/client';
import type { ContentRating, LibraryAsset, LibraryAssetUpdate } from '../types/library';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const immutableKeys = new Set(['id', 'sourceId', 'name', 'title']);
const isObject = (value: JsonValue): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const labelOf = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const blankLike = (value: JsonValue, key = ''): JsonValue => {
  if (key === 'id') return crypto.randomUUID();
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return key === 'lengthDays' ? 1 : 0;
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) return [];
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, blankLike(child, childKey)]));
  return null;
};

function StructuredObjectEditor({ value, onChange, depth = 0 }: { value: JsonObject; onChange: (value: JsonObject) => void; depth?: number }) {
  const entries = Object.entries(value).filter(([key]) => !immutableKeys.has(key));
  return <div className={`structured-fields depth-${Math.min(depth, 2)}`}>{entries.map(([key, fieldValue]) => (
    <StructuredField key={key} fieldKey={key} value={fieldValue} depth={depth} onChange={(next) => onChange({ ...value, [key]: next })} />
  ))}</div>;
}

function StructuredField({ fieldKey, value, onChange, depth }: { fieldKey: string; value: JsonValue; onChange: (value: JsonValue) => void; depth: number }) {
  const label = labelOf(fieldKey);
  if (isObject(value)) return <fieldset className="structured-group"><legend>{label}</legend><StructuredObjectEditor value={value} onChange={onChange} depth={depth + 1} /></fieldset>;
  if (Array.isArray(value)) {
    const objectItems = value.filter(isObject);
    if (objectItems.length === value.length && value.length > 0) return <fieldset className="structured-group structured-repeater"><legend>{label}</legend>{objectItems.map((item, index) => <section className="structured-repeater__item" key={`${fieldKey}-${index}`}><header><strong>{label} {index + 1}</strong><span><button type="button" className="icon-button" title="Duplicate" onClick={() => onChange([...value.slice(0, index + 1), structuredClone(item), ...value.slice(index + 1)])}><Copy size={15} /></button><button type="button" className="icon-button danger" title="Remove" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></span></header><StructuredObjectEditor value={item} depth={depth + 1} onChange={(next) => onChange(value.map((current, itemIndex) => itemIndex === index ? next : current))} /></section>)}<button type="button" className="button button--secondary editor-add" onClick={() => onChange([...value, blankLike(objectItems[0], fieldKey)])}><Plus size={15} /> Add {label.toLocaleLowerCase()}</button></fieldset>;
    return <label className="editor-field"><span>{label}</span><textarea rows={Math.max(3, Math.min(8, value.length + 1))} value={value.map(String).join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} /><small>One item per line</small></label>;
  }
  if (typeof value === 'boolean') return <label className="editor-toggle"><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
  if (typeof value === 'number') return <label className="editor-field"><span>{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
  const text = value == null ? '' : String(value);
  return <label className="editor-field"><span>{label}</span>{text.length > 90 || /description|history|custom|note|prompt|rule|fact|culture|society|origin/i.test(fieldKey) ? <textarea rows={4} value={text} onChange={(event) => onChange(event.target.value)} /> : <input value={text} onChange={(event) => onChange(event.target.value)} />}</label>;
}

export function GenericAssetEditor({ asset }: { asset: LibraryAsset }) {
  const navigate = useNavigate();
  const [name, setName] = useState(asset.name);
  const [summary, setSummary] = useState(asset.summary);
  const [contentRating, setContentRating] = useState<ContentRating>(asset.contentRating ?? 'sfw');
  const [tags, setTags] = useState(asset.tags.join('\n'));
  const [visualTone, setVisualTone] = useState<LibraryAsset['visualTone']>(asset.visualTone);
  const [document, setDocument] = useState<JsonObject>(() => structuredClone(asset.document ?? {}) as JsonObject);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const update = <T,>(setter: (value: T) => void, value: T) => { setter(value); setDirty(true); setMessage(''); };
  const payload = useMemo<LibraryAssetUpdate>(() => ({ name: name.trim(), summary: summary.trim(), contentRating, tags: tags.split('\n').map((tag) => tag.trim()).filter(Boolean), visualTone, document }), [name, summary, contentRating, tags, visualTone, document]);
  const save = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!payload.name) return setMessage('Record name is required.');
    setSaving(true); setMessage('');
    try { await libraryApi.updateAsset(asset.id, payload); setDirty(false); setMessage('Record saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The record could not be saved.'); }
    finally { setSaving(false); }
  }, [asset.id, payload]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') { event.preventDefault(); void save(); } };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', shortcut); };
  }, [dirty, save]);

  return <form className="record-editor" onSubmit={save}><header className="editor-header"><div><span className="eyebrow">{asset.type} editor</span><h1>{asset.name}</h1><p>Changes remain connected to this record and its immutable Discord ownership.</p></div><div className="editor-header__actions"><span className={dirty ? 'editor-dirty is-dirty' : 'editor-dirty'}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span><button className="button button--secondary" type="button" onClick={() => navigate(`/asset/${asset.id}`)}>Cancel</button><button className="button button--primary" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save record'}</button></div></header><div className="editor-layout"><section className="editor-panel"><h2>Library card</h2><div className="editor-grid"><label className="editor-field"><span>Name</span><input value={name} maxLength={120} onChange={(event) => update(setName, event.target.value)} /></label><label className="editor-field editor-field--wide"><span>Summary</span><textarea rows={4} maxLength={2000} value={summary} onChange={(event) => update(setSummary, event.target.value)} /></label><label className="editor-field"><span>Content rating</span><select value={contentRating} onChange={(event) => update(setContentRating, event.target.value as ContentRating)}><option value="sfw">SFW</option><option value="adult">Adult</option></select></label><label className="editor-field"><span>Visual tone</span><select value={visualTone} onChange={(event) => update(setVisualTone, event.target.value as LibraryAsset['visualTone'])}>{['moon','forest','ember','mist','violet','river'].map((tone) => <option value={tone} key={tone}>{labelOf(tone)}</option>)}</select></label><label className="editor-field editor-field--wide"><span>Tags</span><textarea rows={4} value={tags} onChange={(event) => update(setTags, event.target.value)} /><small>One tag per line</small></label></div></section><section className="editor-panel"><h2>Structured record</h2><p className="editor-panel__intro">Edit the authored fields stored with this record. Stable source IDs remain protected.</p><StructuredObjectEditor value={document} onChange={(value) => update(setDocument, value)} /></section></div><footer className="editor-footer"><span role="status">{message}</span><small>Tip: press Ctrl+S to save.</small></footer></form>;
}
