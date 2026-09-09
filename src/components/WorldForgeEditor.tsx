import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { libraryApi } from '../api/client';
import type { ContentRating, LibraryAsset, LibraryAssetUpdate } from '../types/library';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
type TabId = 'identity' | 'lore' | 'places' | 'people' | 'societies' | 'families' | 'memory' | 'rules' | 'time';

type SelectOption = { value: string; label: string };

type EntityMode = 'new' | 'edit' | 'child' | 'duplicate';

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'lore', label: 'Lore' },
  { id: 'places', label: 'Places' },
  { id: 'people', label: 'Species & Factions' },
  { id: 'societies', label: 'Peoples & Societies' },
  { id: 'families', label: 'Family Trees' },
  { id: 'memory', label: 'Memory & Timeline' },
  { id: 'rules', label: 'Rules' },
  { id: 'time', label: 'Time & Weather' },
];

const locationKinds = ['continent', 'major region', 'region', 'subregion', 'territory', 'settlement', 'town', 'village', 'district', 'wilderness', 'building', 'landmark', 'road or trail', 'river', 'lake', 'sea or ocean', 'other'];
const societyTypes = ['clan', 'tribe', 'band', 'nation', 'confederacy', 'chiefdom', 'village_community', 'nomadic_people', 'pack', 'pride', 'herd', 'flock', 'colony', 'house', 'lineage', 'other'];
const lifestyles = ['nomadic', 'settled', 'mixed'];
const canonStatuses = ['canon', 'draft', 'disputed', 'historical'];
const familyRelationshipKinds = ['parent', 'partner', 'sibling', 'guardian'];
const memoryKinds = ['event', 'discovery', 'death', 'conflict', 'persistent_change'];
const memoryVisibilities = ['common', 'regional', 'faction', 'family', 'private', 'disputed'];

const isObject = (value: JsonValue | undefined): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asObject = (value: JsonValue | undefined): JsonObject => isObject(value) ? value : {};
const asArray = (value: JsonValue | undefined): JsonValue[] => Array.isArray(value) ? value : [];
const asObjects = (value: JsonValue | undefined): JsonObject[] => asArray(value).filter(isObject);
const asStrings = (value: JsonValue | undefined): string[] => asArray(value).filter((item): item is string => typeof item === 'string');
const asString = (value: JsonValue | undefined): string => typeof value === 'string' ? value : '';
const asNumber = (value: JsonValue | undefined, fallback = 0): number => typeof value === 'number' ? value : fallback;
const asBoolean = (value: JsonValue | undefined): boolean => Boolean(value);
const nice = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const lineArray = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
const lines = (value: JsonValue | undefined) => asStrings(value).join('\n');
const idOf = (item: JsonObject) => asString(item.id);
const nameOf = (item: JsonObject, fallback = 'Untitled') => asString(item.name) || asString(item.title) || fallback;

function updateObject(root: JsonObject, key: string, childKey: string, value: JsonValue): JsonObject {
  const child = asObject(root[key]);
  return { ...root, [key]: { ...child, [childKey]: value } };
}

function wouldCreateCycle(items: JsonObject[], entityId: string, nextParentId: string | undefined, parentKey: 'parentLocationId' | 'parentSocietyId'): boolean {
  if (!nextParentId) return false;
  if (nextParentId === entityId) return true;
  const parents = new Map(items.map((item) => [idOf(item), asString(item[parentKey]) || undefined]));
  let cursor: string | undefined = nextParentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === entityId || visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = parents.get(cursor);
  }
  return false;
}

function TextField({ label, value, rows, hint, onChange }: { label: string; value: string; rows?: number; hint?: string; onChange: (value: string) => void }) {
  return <label className="forge-field"><span>{label}</span>{rows ? <textarea rows={rows} value={value} placeholder={hint} onChange={(event) => onChange(event.target.value)} /> : <input value={value} placeholder={hint} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className="forge-field"><span>{label}</span><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void }) {
  return <label className="forge-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="forge-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function LinesField({ label, value, hint, onChange }: { label: string; value: string[]; hint?: string; onChange: (value: string[]) => void }) {
  return <label className="forge-field"><span>{label}</span><textarea rows={4} value={value.join('\n')} placeholder={hint} onChange={(event) => onChange(lineArray(event.target.value))} /><small>One item per line</small></label>;
}

function MultiSelectField({ label, values, options, onChange }: { label: string; values: string[]; options: SelectOption[]; onChange: (values: string[]) => void }) {
  const selected = new Set(values);
  const toggle = (id: string) => onChange(selected.has(id) ? values.filter((value) => value !== id) : [...values, id]);
  return <fieldset className="forge-multiselect"><legend>{label}</legend>
    {options.length === 0 ? <small>No available records.</small> : <div className="forge-multiselect__grid">{options.map((option) => <label key={option.value}><input type="checkbox" checked={selected.has(option.value)} onChange={() => toggle(option.value)} /><span>{option.label}</span></label>)}</div>}
  </fieldset>;
}

function ComposerHeader({ title, description, editing, onCancel }: { title: string; description: string; editing?: boolean; onCancel?: () => void }) {
  return <header className="forge-composer__header"><div><h3>{title}</h3><p>{description}</p></div>{editing && onCancel ? <button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button> : null}</header>;
}

function EntityActions({ onEdit, onDuplicate, onDelete, extra }: { onEdit: () => void; onDuplicate: () => void; onDelete: () => void; extra?: Array<{ label: string; action: () => void }> }) {
  return <div className="forge-card-actions">
    {extra?.map((item) => <button key={item.label} type="button" className="button button--secondary forge-mini-action" onClick={item.action}>{item.label}</button>)}
    <button type="button" className="icon-button" title="Edit" onClick={onEdit}>✎</button>
    <button type="button" className="icon-button" title="Duplicate" onClick={onDuplicate}><Copy size={14} /></button>
    <button type="button" className="icon-button danger" title="Delete" onClick={onDelete}><Trash2 size={14} /></button>
  </div>;
}

function LocationEditor({ value, memories, societies, onChange }: { value: JsonValue | undefined; memories: JsonObject[]; societies: JsonObject[]; onChange: (locations: JsonObject[]) => void }) {
  const locations = asObjects(value);
  const [mode, setMode] = useState<EntityMode>('new');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ name: '', kind: 'region', parentLocationId: '', description: '' });
  const names = new Map(locations.map((item) => [idOf(item), nameOf(item)]));

  const reset = () => { setMode('new'); setEditingId(''); setForm({ name: '', kind: 'region', parentLocationId: '', description: '' }); };
  const start = (item: JsonObject, nextMode: EntityMode) => {
    setMode(nextMode);
    setEditingId(nextMode === 'edit' ? idOf(item) : '');
    setForm({
      name: nextMode === 'duplicate' ? `${nameOf(item)} copy` : nextMode === 'child' ? '' : nameOf(item),
      kind: nextMode === 'child' ? 'building' : asString(item.kind) || 'region',
      parentLocationId: nextMode === 'child' ? idOf(item) : asString(item.parentLocationId),
      description: nextMode === 'child' ? '' : asString(item.description),
    });
  };
  const save = () => {
    if (!form.name.trim()) return window.alert('Location name is required.');
    const id = editingId || crypto.randomUUID();
    const parentId = form.parentLocationId || undefined;
    if (wouldCreateCycle(locations, id, parentId, 'parentLocationId')) return window.alert('A location cannot be moved inside itself or one of its children.');
    const existing = locations.find((item) => idOf(item) === id);
    const next: JsonObject = { ...(existing ?? {}), id, name: form.name.trim(), kind: form.kind, description: form.description };
    if (parentId) next.parentLocationId = parentId; else delete next.parentLocationId;
    onChange(existing ? locations.map((item) => idOf(item) === id ? next : item) : [...locations, next]);
    reset();
  };
  const remove = (item: JsonObject) => {
    const id = idOf(item);
    const referenced = memories.some((memory) => asStrings(memory.locationIds).includes(id)) || societies.some((society) => [...asStrings(society.territoryLocationIds), ...asStrings(society.settlementLocationIds)].includes(id));
    if (referenced) return window.alert('This location is still referenced by a memory or society. Remove those links first.');
    if (!window.confirm(`Delete ${nameOf(item)}?`)) return;
    const parent = asString(item.parentLocationId);
    onChange(locations.filter((location) => idOf(location) !== id).map((location) => asString(location.parentLocationId) === id ? { ...location, ...(parent ? { parentLocationId: parent } : { parentLocationId: null }) } : location).map((location) => location.parentLocationId === null ? Object.fromEntries(Object.entries(location).filter(([key]) => key !== 'parentLocationId')) as JsonObject : location));
  };
  const move = (item: JsonObject) => {
    const candidates = locations.filter((candidate) => idOf(candidate) !== idOf(item) && !wouldCreateCycle(locations, idOf(item), idOf(candidate), 'parentLocationId'));
    const answer = window.prompt(`Move ${nameOf(item)} inside which location?\nLeave blank for no parent.\n${candidates.map((candidate) => `${idOf(candidate)} = ${nameOf(candidate)}`).join('\n')}`, asString(item.parentLocationId));
    if (answer === null) return;
    const nextParent = answer.trim();
    if (nextParent && !candidates.some((candidate) => idOf(candidate) === nextParent)) return window.alert('Unknown or invalid parent location ID.');
    onChange(locations.map((location) => idOf(location) === idOf(item) ? { ...location, ...(nextParent ? { parentLocationId: nextParent } : {}) } : location).map((location) => idOf(location) === idOf(item) && !nextParent ? Object.fromEntries(Object.entries(location).filter(([key]) => key !== 'parentLocationId')) as JsonObject : location));
  };

  return <>
    <div className="forge-composer">
      <ComposerHeader title={mode === 'edit' ? 'Edit location' : mode === 'child' ? 'Add child location' : mode === 'duplicate' ? 'Duplicate location' : 'Add location'} description={mode === 'edit' ? 'The existing location ID is preserved.' : mode === 'child' ? 'The parent location is already selected.' : 'Create a place inside this world.'} editing={mode !== 'new'} onCancel={reset} />
      <div className="forge-grid forge-grid--3"><TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} /><SelectField label="Kind" value={form.kind} options={locationKinds.map((kind) => ({ value: kind, label: nice(kind) }))} onChange={(kind) => setForm({ ...form, kind })} /><SelectField label="Inside location" value={form.parentLocationId} options={[{ value: '', label: 'No parent' }, ...locations.filter((item) => !editingId || !wouldCreateCycle(locations, editingId, idOf(item), 'parentLocationId')).map((item) => ({ value: idOf(item), label: nameOf(item) }))]} onChange={(parentLocationId) => setForm({ ...form, parentLocationId })} /></div>
      <TextField label="Description" rows={3} value={form.description} onChange={(description) => setForm({ ...form, description })} />
      <button type="button" className="button button--primary" onClick={save}><Plus size={15} /> {mode === 'edit' ? 'Save location' : 'Add location'}</button>
    </div>
    <div className="forge-entity-stack">{locations.length === 0 ? <p className="forge-empty">No locations yet.</p> : locations.map((item) => <article className="forge-entity-card" key={idOf(item)}><header><div><span className="eyebrow">{nice(asString(item.kind) || 'place')}{asString(item.parentLocationId) ? ` · inside ${names.get(asString(item.parentLocationId)) ?? 'Unknown'}` : ''}</span><strong>{nameOf(item)}</strong></div><EntityActions onEdit={() => start(item, 'edit')} onDuplicate={() => start(item, 'duplicate')} onDelete={() => remove(item)} extra={[{ label: 'Add child', action: () => start(item, 'child') }, { label: 'Move', action: () => move(item) }]} /></header><p className="forge-card-copy">{asString(item.description) || 'No description.'}</p></article>)}</div>
  </>;
}

function SimpleEntityEditor({ label, value, onChange }: { label: 'Species' | 'Faction'; value: JsonValue | undefined; onChange: (items: JsonObject[]) => void }) {
  const items = asObjects(value);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const reset = () => { setEditingId(''); setForm({ name: '', description: '' }); };
  const edit = (item: JsonObject) => { setEditingId(idOf(item)); setForm({ name: nameOf(item), description: asString(item.description) }); };
  const duplicate = (item: JsonObject) => { setEditingId(''); setForm({ name: `${nameOf(item)} copy`, description: asString(item.description) }); };
  const save = () => {
    if (!form.name.trim()) return window.alert(`${label} name is required.`);
    const id = editingId || crypto.randomUUID();
    const existing = items.find((item) => idOf(item) === id);
    const next = { ...(existing ?? {}), id, name: form.name.trim(), description: form.description };
    onChange(existing ? items.map((item) => idOf(item) === id ? next : item) : [...items, next]);
    reset();
  };
  return <div><div className="forge-composer"><ComposerHeader title={editingId ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`} description={editingId ? 'Existing ID will be preserved.' : `Define a ${label.toLowerCase()} in this world.`} editing={Boolean(editingId)} onCancel={reset} /><TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} /><TextField label={label === 'Species' ? 'World definition' : 'Purpose and influence'} rows={3} value={form.description} onChange={(description) => setForm({ ...form, description })} /><button type="button" className="button button--primary" onClick={save}><Plus size={15} /> {editingId ? `Save ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}</button></div><div className="forge-entity-stack forge-compact-stack">{items.map((item) => <article className="forge-entity-card" key={idOf(item)}><header><div><span className="eyebrow">{label}</span><strong>{nameOf(item)}</strong></div><EntityActions onEdit={() => edit(item)} onDuplicate={() => duplicate(item)} onDelete={() => onChange(items.filter((candidate) => idOf(candidate) !== idOf(item)))} /></header><p className="forge-card-copy">{asString(item.description) || 'No description.'}</p></article>)}</div></div>;
}

function SocietyEditor({ value, locations, species, families, factions, onChange }: { value: JsonValue | undefined; locations: JsonObject[]; species: JsonObject[]; families: JsonObject[]; factions: JsonObject[]; onChange: (societies: JsonObject[]) => void }) {
  const societies = asObjects(value);
  const empty = () => ({ name: '', type: 'clan', parentSocietyId: '', description: '', origin: '', territoryLocationIds: [] as string[], territoryNotes: '', seasonalMovement: '', lifestyle: 'settled', speciesIds: [] as string[], kinshipBasis: '', membershipRules: '', leadershipStructure: '', decisionMaking: '', customs: '', beliefs: '', languageDialect: '', livelihood: '', allySocietyIds: [] as string[], rivalSocietyIds: [] as string[], familyIds: [] as string[], factionIds: [] as string[], settlementLocationIds: [] as string[], currentStatus: '', canonStatus: 'canon' });
  const [mode, setMode] = useState<EntityMode>('new');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(empty());
  const societyNames = new Map(societies.map((item) => [idOf(item), nameOf(item)]));
  const options = (items: JsonObject[]) => items.map((item) => ({ value: idOf(item), label: nameOf(item) }));
  const reset = () => { setMode('new'); setEditingId(''); setForm(empty()); };
  const start = (item: JsonObject, nextMode: EntityMode) => {
    setMode(nextMode); setEditingId(nextMode === 'edit' ? idOf(item) : '');
    setForm({
      name: nextMode === 'duplicate' ? `${nameOf(item)} copy` : nextMode === 'child' ? '' : nameOf(item), type: asString(item.type) || 'clan', parentSocietyId: nextMode === 'child' ? idOf(item) : asString(item.parentSocietyId), description: nextMode === 'child' ? '' : asString(item.description), origin: nextMode === 'child' ? '' : asString(item.origin), territoryLocationIds: nextMode === 'child' ? [] : asStrings(item.territoryLocationIds), territoryNotes: nextMode === 'child' ? '' : asString(item.territoryNotes), seasonalMovement: nextMode === 'child' ? '' : asString(item.seasonalMovement), lifestyle: asString(item.lifestyle) || 'settled', speciesIds: nextMode === 'child' ? [] : asStrings(item.speciesIds), kinshipBasis: nextMode === 'child' ? '' : asString(item.kinshipBasis), membershipRules: nextMode === 'child' ? '' : asString(item.membershipRules), leadershipStructure: nextMode === 'child' ? '' : asString(item.leadershipStructure), decisionMaking: nextMode === 'child' ? '' : asString(item.decisionMaking), customs: nextMode === 'child' ? '' : asString(item.customs), beliefs: nextMode === 'child' ? '' : asString(item.beliefs), languageDialect: nextMode === 'child' ? '' : asString(item.languageDialect), livelihood: nextMode === 'child' ? '' : asString(item.livelihood), allySocietyIds: nextMode === 'child' ? [] : asStrings(item.allySocietyIds), rivalSocietyIds: nextMode === 'child' ? [] : asStrings(item.rivalSocietyIds), familyIds: nextMode === 'child' ? [] : asStrings(item.familyIds), factionIds: nextMode === 'child' ? [] : asStrings(item.factionIds), settlementLocationIds: nextMode === 'child' ? [] : asStrings(item.settlementLocationIds), currentStatus: nextMode === 'child' ? '' : asString(item.currentStatus), canonStatus: asString(item.canonStatus) || 'canon',
    });
  };
  const save = () => {
    if (!form.name.trim()) return window.alert('Society name is required.');
    const id = editingId || crypto.randomUUID();
    if (wouldCreateCycle(societies, id, form.parentSocietyId || undefined, 'parentSocietyId')) return window.alert('A society cannot be moved beneath itself or one of its descendants.');
    const existing = societies.find((item) => idOf(item) === id);
    const next: JsonObject = { ...(existing ?? {}), id, ...form, name: form.name.trim() };
    if (!form.parentSocietyId) delete next.parentSocietyId;
    onChange(existing ? societies.map((item) => idOf(item) === id ? next : item) : [...societies, next]);
    reset();
  };
  const remove = (item: JsonObject) => {
    const id = idOf(item);
    if (!window.confirm(`Delete ${nameOf(item)}?`)) return;
    const parent = asString(item.parentSocietyId);
    onChange(societies.filter((candidate) => idOf(candidate) !== id).map((candidate) => {
      let next = { ...candidate };
      if (asString(next.parentSocietyId) === id) { if (parent) next.parentSocietyId = parent; else delete next.parentSocietyId; }
      next.allySocietyIds = asStrings(next.allySocietyIds).filter((value) => value !== id);
      next.rivalSocietyIds = asStrings(next.rivalSocietyIds).filter((value) => value !== id);
      return next;
    }));
  };
  const move = (item: JsonObject) => {
    const candidates = societies.filter((candidate) => idOf(candidate) !== idOf(item) && !wouldCreateCycle(societies, idOf(item), idOf(candidate), 'parentSocietyId'));
    const answer = window.prompt(`Move ${nameOf(item)} beneath which society?\nLeave blank for no parent.\n${candidates.map((candidate) => `${idOf(candidate)} = ${nameOf(candidate)}`).join('\n')}`, asString(item.parentSocietyId));
    if (answer === null) return;
    const parentId = answer.trim();
    if (parentId && !candidates.some((candidate) => idOf(candidate) === parentId)) return window.alert('Unknown or invalid parent society ID.');
    onChange(societies.map((candidate) => {
      if (idOf(candidate) !== idOf(item)) return candidate;
      const next = { ...candidate };
      if (parentId) next.parentSocietyId = parentId; else delete next.parentSocietyId;
      return next;
    }));
  };
  const link = (item: JsonObject, key: 'familyIds' | 'territoryLocationIds' | 'factionIds', choices: JsonObject[]) => {
    const selected = asStrings(item[key]);
    const answer = window.prompt(`Enter IDs separated by commas. Available:\n${choices.map((choice) => `${idOf(choice)} = ${nameOf(choice)}`).join('\n')}`, selected.join(','));
    if (answer === null) return;
    const ids = answer.split(',').map((part) => part.trim()).filter(Boolean);
    if (ids.some((id) => !choices.some((choice) => idOf(choice) === id))) return window.alert('One or more IDs are invalid.');
    onChange(societies.map((candidate) => idOf(candidate) === idOf(item) ? { ...candidate, [key]: ids } : candidate));
  };

  const selfExcluded = societies.filter((item) => idOf(item) !== editingId);
  return <>
    <div className="forge-composer forge-composer--large">
      <ComposerHeader title={mode === 'edit' ? 'Edit society' : mode === 'child' ? 'Add child society' : mode === 'duplicate' ? 'Duplicate society' : 'Add society'} description={mode === 'edit' ? 'The society ID and links are preserved.' : mode === 'child' ? 'The parent society is already selected.' : 'Create a people or social structure.'} editing={mode !== 'new'} onCancel={reset} />
      <section className="forge-form-section"><h4>Identity & structure</h4><div className="forge-grid forge-grid--3"><TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} /><SelectField label="Type" value={form.type} options={societyTypes.map((type) => ({ value: type, label: nice(type) }))} onChange={(type) => setForm({ ...form, type })} /><SelectField label="Parent society" value={form.parentSocietyId} options={[{ value: '', label: 'No parent' }, ...selfExcluded.filter((item) => !editingId || !wouldCreateCycle(societies, editingId, idOf(item), 'parentSocietyId')).map((item) => ({ value: idOf(item), label: nameOf(item) }))]} onChange={(parentSocietyId) => setForm({ ...form, parentSocietyId })} /></div><TextField label="Description" rows={3} value={form.description} onChange={(description) => setForm({ ...form, description })} /><TextField label="Founding / origin" rows={3} value={form.origin} onChange={(origin) => setForm({ ...form, origin })} /></section>
      <section className="forge-form-section"><h4>Territory & membership</h4><div className="forge-grid forge-grid--3"><SelectField label="Lifestyle" value={form.lifestyle} options={lifestyles.map((value) => ({ value, label: nice(value) }))} onChange={(lifestyle) => setForm({ ...form, lifestyle })} /><TextField label="Kinship basis" value={form.kinshipBasis} onChange={(kinshipBasis) => setForm({ ...form, kinshipBasis })} /><TextField label="Membership rules" value={form.membershipRules} onChange={(membershipRules) => setForm({ ...form, membershipRules })} /></div><div className="forge-grid"><MultiSelectField label="Territory locations" values={form.territoryLocationIds} options={options(locations)} onChange={(territoryLocationIds) => setForm({ ...form, territoryLocationIds })} /><MultiSelectField label="Known settlements" values={form.settlementLocationIds} options={options(locations)} onChange={(settlementLocationIds) => setForm({ ...form, settlementLocationIds })} /><MultiSelectField label="Species composition" values={form.speciesIds} options={options(species)} onChange={(speciesIds) => setForm({ ...form, speciesIds })} /><MultiSelectField label="Related families" values={form.familyIds} options={options(families)} onChange={(familyIds) => setForm({ ...form, familyIds })} /></div><TextField label="Territory notes" rows={3} value={form.territoryNotes} onChange={(territoryNotes) => setForm({ ...form, territoryNotes })} /><TextField label="Seasonal movement" rows={3} value={form.seasonalMovement} onChange={(seasonalMovement) => setForm({ ...form, seasonalMovement })} /></section>
      <section className="forge-form-section"><h4>Governance & life</h4><div className="forge-grid"><TextField label="Leadership structure" rows={3} value={form.leadershipStructure} onChange={(leadershipStructure) => setForm({ ...form, leadershipStructure })} /><TextField label="Decision making" rows={3} value={form.decisionMaking} onChange={(decisionMaking) => setForm({ ...form, decisionMaking })} /><TextField label="Customs" rows={3} value={form.customs} onChange={(customs) => setForm({ ...form, customs })} /><TextField label="Beliefs" rows={3} value={form.beliefs} onChange={(beliefs) => setForm({ ...form, beliefs })} /><TextField label="Language / dialect" value={form.languageDialect} onChange={(languageDialect) => setForm({ ...form, languageDialect })} /><TextField label="Livelihood" value={form.livelihood} onChange={(livelihood) => setForm({ ...form, livelihood })} /></div></section>
      <section className="forge-form-section"><h4>Relations & canon</h4><div className="forge-grid"><MultiSelectField label="Allies" values={form.allySocietyIds} options={options(selfExcluded)} onChange={(allySocietyIds) => setForm({ ...form, allySocietyIds })} /><MultiSelectField label="Rivals" values={form.rivalSocietyIds} options={options(selfExcluded)} onChange={(rivalSocietyIds) => setForm({ ...form, rivalSocietyIds })} /><MultiSelectField label="Related factions" values={form.factionIds} options={options(factions)} onChange={(factionIds) => setForm({ ...form, factionIds })} /><div><TextField label="Current status" rows={3} value={form.currentStatus} onChange={(currentStatus) => setForm({ ...form, currentStatus })} /><SelectField label="Canon status" value={form.canonStatus} options={canonStatuses.map((value) => ({ value, label: nice(value) }))} onChange={(canonStatus) => setForm({ ...form, canonStatus })} /></div></div></section>
      <button type="button" className="button button--primary" onClick={save}>{mode === 'edit' ? 'Save society' : 'Add society'}</button>
    </div>
    <div className="forge-entity-stack">{societies.length === 0 ? <p className="forge-empty">No peoples or societies yet.</p> : societies.map((item) => <article className="forge-entity-card" key={idOf(item)}><header><div><span className="eyebrow">{nice(asString(item.type) || 'society')}{asString(item.parentSocietyId) ? ` · within ${societyNames.get(asString(item.parentSocietyId)) ?? 'Unknown'}` : ''}</span><strong>{nameOf(item)}</strong></div><EntityActions onEdit={() => start(item, 'edit')} onDuplicate={() => start(item, 'duplicate')} onDelete={() => remove(item)} extra={[{ label: 'Add child', action: () => start(item, 'child') }, { label: 'Move', action: () => move(item) }, { label: 'Link family', action: () => link(item, 'familyIds', families) }, { label: 'Link place', action: () => link(item, 'territoryLocationIds', locations) }, { label: 'Link faction', action: () => link(item, 'factionIds', factions) }]} /></header><p className="forge-card-copy">{asString(item.description) || 'No description.'}</p><div className="forge-tag-row"><span>{nice(asString(item.lifestyle) || 'settled')}</span><span>{nice(asString(item.canonStatus) || 'canon')}</span>{asStrings(item.familyIds).length ? <span>{asStrings(item.familyIds).length} families</span> : null}{asStrings(item.territoryLocationIds).length ? <span>{asStrings(item.territoryLocationIds).length} territories</span> : null}</div></article>)}</div>
  </>;
}

function FamilyEditor({ value, onChange }: { value: JsonValue | undefined; onChange: (families: JsonObject[]) => void }) {
  const families = asObjects(value);
  const [familyEditId, setFamilyEditId] = useState('');
  const [familyForm, setFamilyForm] = useState({ name: '', description: '' });
  const [personForm, setPersonForm] = useState({ familyId: '', personId: '', name: '', description: '', characterId: '' });
  const [linkForm, setLinkForm] = useState({ familyId: '', relationshipId: '', fromPersonId: '', toPersonId: '', kind: 'parent', notes: '' });
  const familyOptions = families.map((family) => ({ value: idOf(family), label: nameOf(family) }));
  const selectedFamily = families.find((family) => idOf(family) === linkForm.familyId);
  const peopleOptions = asObjects(selectedFamily?.people).map((person) => ({ value: idOf(person), label: nameOf(person) }));

  const saveFamily = () => {
    if (!familyForm.name.trim()) return window.alert('Family name is required.');
    const id = familyEditId || crypto.randomUUID();
    const existing = families.find((family) => idOf(family) === id);
    const next = { ...(existing ?? {}), id, name: familyForm.name.trim(), description: familyForm.description, people: asObjects(existing?.people), relationships: asObjects(existing?.relationships) };
    onChange(existing ? families.map((family) => idOf(family) === id ? next : family) : [...families, next]);
    setFamilyEditId(''); setFamilyForm({ name: '', description: '' });
  };
  const savePerson = () => {
    const family = families.find((candidate) => idOf(candidate) === personForm.familyId);
    if (!family || !personForm.name.trim()) return window.alert('Select a family and enter a person name.');
    const people = asObjects(family.people);
    const id = personForm.personId || crypto.randomUUID();
    const existing = people.find((person) => idOf(person) === id);
    const next: JsonObject = { ...(existing ?? {}), id, name: personForm.name.trim(), description: personForm.description };
    if (personForm.characterId.trim()) next.characterId = personForm.characterId.trim(); else delete next.characterId;
    const updated = existing ? people.map((person) => idOf(person) === id ? next : person) : [...people, next];
    onChange(families.map((candidate) => idOf(candidate) === idOf(family) ? { ...candidate, people: updated } : candidate));
    setPersonForm({ familyId: personForm.familyId, personId: '', name: '', description: '', characterId: '' });
  };
  const saveRelationship = () => {
    const family = families.find((candidate) => idOf(candidate) === linkForm.familyId);
    if (!family || !linkForm.fromPersonId || !linkForm.toPersonId) return window.alert('Choose two people from the same family.');
    if (linkForm.fromPersonId === linkForm.toPersonId) return window.alert('Choose two different people.');
    const relationships = asObjects(family.relationships);
    const id = linkForm.relationshipId || crypto.randomUUID();
    const existing = relationships.find((relationship) => idOf(relationship) === id);
    const next = { ...(existing ?? {}), id, fromPersonId: linkForm.fromPersonId, toPersonId: linkForm.toPersonId, kind: linkForm.kind, notes: linkForm.notes };
    const updated = existing ? relationships.map((relationship) => idOf(relationship) === id ? next : relationship) : [...relationships, next];
    onChange(families.map((candidate) => idOf(candidate) === idOf(family) ? { ...candidate, relationships: updated } : candidate));
    setLinkForm({ familyId: linkForm.familyId, relationshipId: '', fromPersonId: '', toPersonId: '', kind: 'parent', notes: '' });
  };
  const duplicateFamily = (family: JsonObject) => {
    const personIdMap = new Map(asObjects(family.people).map((person) => [idOf(person), crypto.randomUUID()]));
    const people = asObjects(family.people).map((person) => ({ ...structuredClone(person), id: personIdMap.get(idOf(person))! }));
    const relationships = asObjects(family.relationships).map((relationship) => ({ ...structuredClone(relationship), id: crypto.randomUUID(), fromPersonId: personIdMap.get(asString(relationship.fromPersonId)) ?? asString(relationship.fromPersonId), toPersonId: personIdMap.get(asString(relationship.toPersonId)) ?? asString(relationship.toPersonId) }));
    onChange([...families, { ...structuredClone(family), id: crypto.randomUUID(), name: `${nameOf(family)} copy`, people, relationships }]);
  };
  const removePerson = (family: JsonObject, person: JsonObject) => {
    if (!window.confirm(`Remove ${nameOf(person)} from ${nameOf(family)}?`)) return;
    const id = idOf(person);
    onChange(families.map((candidate) => idOf(candidate) === idOf(family) ? { ...candidate, people: asObjects(candidate.people).filter((entry) => idOf(entry) !== id), relationships: asObjects(candidate.relationships).filter((relationship) => asString(relationship.fromPersonId) !== id && asString(relationship.toPersonId) !== id) } : candidate));
  };

  return <>
    <div className="forge-grid forge-grid--3 forge-family-composers">
      <div className="forge-composer"><ComposerHeader title={familyEditId ? 'Edit family' : 'Create family'} description="Define a family or household tree." editing={Boolean(familyEditId)} onCancel={() => { setFamilyEditId(''); setFamilyForm({ name: '', description: '' }); }} /><TextField label="Name" value={familyForm.name} onChange={(name) => setFamilyForm({ ...familyForm, name })} /><TextField label="Description" rows={3} value={familyForm.description} onChange={(description) => setFamilyForm({ ...familyForm, description })} /><button type="button" className="button button--primary" onClick={saveFamily}>{familyEditId ? 'Save family' : 'Add family'}</button></div>
      <div className="forge-composer"><ComposerHeader title={personForm.personId ? 'Edit person' : 'Add person'} description="Add a person to a family." editing={Boolean(personForm.personId)} onCancel={() => setPersonForm({ familyId: '', personId: '', name: '', description: '', characterId: '' })} /><SelectField label="Family" value={personForm.familyId} options={[{ value: '', label: 'Select family' }, ...familyOptions]} onChange={(familyId) => setPersonForm({ ...personForm, familyId })} /><TextField label="Name" value={personForm.name} onChange={(name) => setPersonForm({ ...personForm, name })} /><TextField label="Place in family" rows={2} value={personForm.description} onChange={(description) => setPersonForm({ ...personForm, description })} /><TextField label="Character ID" value={personForm.characterId} onChange={(characterId) => setPersonForm({ ...personForm, characterId })} /><button type="button" className="button button--primary" onClick={savePerson}>{personForm.personId ? 'Save person' : 'Add person'}</button></div>
      <div className="forge-composer"><ComposerHeader title={linkForm.relationshipId ? 'Edit relationship' : 'Connect people'} description="Define kinship, partnership or guardianship." editing={Boolean(linkForm.relationshipId)} onCancel={() => setLinkForm({ familyId: '', relationshipId: '', fromPersonId: '', toPersonId: '', kind: 'parent', notes: '' })} /><SelectField label="Family" value={linkForm.familyId} options={[{ value: '', label: 'Select family' }, ...familyOptions]} onChange={(familyId) => setLinkForm({ ...linkForm, familyId, fromPersonId: '', toPersonId: '' })} /><SelectField label="First person" value={linkForm.fromPersonId} options={[{ value: '', label: 'Select person' }, ...peopleOptions]} onChange={(fromPersonId) => setLinkForm({ ...linkForm, fromPersonId })} /><SelectField label="Relationship" value={linkForm.kind} options={familyRelationshipKinds.map((kind) => ({ value: kind, label: nice(kind) }))} onChange={(kind) => setLinkForm({ ...linkForm, kind })} /><SelectField label="Second person" value={linkForm.toPersonId} options={[{ value: '', label: 'Select person' }, ...peopleOptions]} onChange={(toPersonId) => setLinkForm({ ...linkForm, toPersonId })} /><TextField label="Notes" rows={2} value={linkForm.notes} onChange={(notes) => setLinkForm({ ...linkForm, notes })} /><button type="button" className="button button--primary" onClick={saveRelationship}>{linkForm.relationshipId ? 'Save relationship' : 'Connect people'}</button></div>
    </div>
    <div className="forge-family-stack">{families.length === 0 ? <p className="forge-empty">Create a family before adding people or relationships.</p> : families.map((family) => {
      const people = asObjects(family.people); const relationships = asObjects(family.relationships); const peopleNames = new Map(people.map((person) => [idOf(person), nameOf(person)]));
      return <article className="forge-family-card" key={idOf(family)}><header><div><span className="eyebrow">Family tree</span><h3>{nameOf(family)}</h3><p>{asString(family.description)}</p></div><EntityActions onEdit={() => { setFamilyEditId(idOf(family)); setFamilyForm({ name: nameOf(family), description: asString(family.description) }); }} onDuplicate={() => duplicateFamily(family)} onDelete={() => onChange(families.filter((candidate) => idOf(candidate) !== idOf(family)))} /></header><div className="forge-family-people">{people.length ? people.map((person) => <div key={idOf(person)}><strong>{nameOf(person)}</strong><small>{asString(person.description)}</small><span><button type="button" onClick={() => setPersonForm({ familyId: idOf(family), personId: idOf(person), name: nameOf(person), description: asString(person.description), characterId: asString(person.characterId) })}>Edit</button><button type="button" onClick={() => removePerson(family, person)}>Remove</button></span></div>) : <small>No people linked yet.</small>}</div><div className="forge-family-links">{relationships.length ? relationships.map((relationship) => <div key={idOf(relationship)}><strong>{peopleNames.get(asString(relationship.fromPersonId)) ?? 'Unknown'}</strong><span>{nice(asString(relationship.kind))}</span><strong>{peopleNames.get(asString(relationship.toPersonId)) ?? 'Unknown'}</strong>{asString(relationship.notes) && <small>{asString(relationship.notes)}</small>}<button type="button" onClick={() => setLinkForm({ familyId: idOf(family), relationshipId: idOf(relationship), fromPersonId: asString(relationship.fromPersonId), toPersonId: asString(relationship.toPersonId), kind: asString(relationship.kind) || 'parent', notes: asString(relationship.notes) })}>Edit</button><button type="button" onClick={() => onChange(families.map((candidate) => idOf(candidate) === idOf(family) ? { ...candidate, relationships: asObjects(candidate.relationships).filter((entry) => idOf(entry) !== idOf(relationship)) } : candidate))}>Remove</button></div>) : <small>No family relationships yet.</small>}</div></article>;
    })}</div>
  </>;
}

function MemoryEditor({ value, locations, factions, families, onChange }: { value: JsonValue | undefined; locations: JsonObject[]; factions: JsonObject[]; families: JsonObject[]; onChange: (memories: JsonObject[]) => void }) {
  const memories = asObjects(value);
  const empty = () => ({ title: '', description: '', kind: 'event', occurredAt: '', visibility: 'common', locationIds: [] as string[], factionIds: [] as string[], familyIds: [] as string[], affectedCharacterIds: [] as string[], persistentEffects: [] as string[] });
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(empty());
  const options = (items: JsonObject[]) => items.map((item) => ({ value: idOf(item), label: nameOf(item) }));
  const reset = () => { setEditingId(''); setForm(empty()); };
  const edit = (memory: JsonObject, duplicate = false) => {
    setEditingId(duplicate ? '' : idOf(memory));
    setForm({ title: duplicate ? `${nameOf(memory)} copy` : nameOf(memory), description: asString(memory.description), kind: asString(memory.kind) || 'event', occurredAt: asString(memory.occurredAt), visibility: asString(memory.visibility) || 'common', locationIds: asStrings(memory.locationIds), factionIds: asStrings(memory.factionIds), familyIds: asStrings(memory.familyIds), affectedCharacterIds: asStrings(memory.affectedCharacterIds), persistentEffects: asStrings(memory.persistentEffects) });
  };
  const save = () => {
    if (!form.title.trim()) return window.alert('Event title is required.');
    const id = editingId || crypto.randomUUID();
    const existing = memories.find((memory) => idOf(memory) === id);
    const next = { ...(existing ?? {}), id, ...form, title: form.title.trim(), createdAt: asString(existing?.createdAt) || new Date().toISOString() };
    onChange(existing ? memories.map((memory) => idOf(memory) === id ? next : memory) : [...memories, next]);
    reset();
  };
  const sorted = [...memories].sort((a, b) => asString(b.occurredAt).localeCompare(asString(a.occurredAt)));
  return <>
    <div className="forge-composer forge-composer--large"><ComposerHeader title={editingId ? 'Edit world memory' : 'Record world memory'} description="Durable events and consequences that belong to the world." editing={Boolean(editingId)} onCancel={reset} /><div className="forge-grid forge-grid--3"><TextField label="Event title" value={form.title} onChange={(title) => setForm({ ...form, title })} /><SelectField label="Kind" value={form.kind} options={memoryKinds.map((value) => ({ value, label: nice(value) }))} onChange={(kind) => setForm({ ...form, kind })} /><TextField label="World date" value={form.occurredAt} onChange={(occurredAt) => setForm({ ...form, occurredAt })} /></div><SelectField label="Visibility" value={form.visibility} options={memoryVisibilities.map((value) => ({ value, label: nice(value) }))} onChange={(visibility) => setForm({ ...form, visibility })} /><TextField label="Description" rows={4} value={form.description} onChange={(description) => setForm({ ...form, description })} /><div className="forge-grid forge-grid--3"><MultiSelectField label="Affected locations" values={form.locationIds} options={options(locations)} onChange={(locationIds) => setForm({ ...form, locationIds })} /><MultiSelectField label="Affected factions" values={form.factionIds} options={options(factions)} onChange={(factionIds) => setForm({ ...form, factionIds })} /><MultiSelectField label="Affected families" values={form.familyIds} options={options(families)} onChange={(familyIds) => setForm({ ...form, familyIds })} /></div><LinesField label="Affected character IDs" value={form.affectedCharacterIds} onChange={(affectedCharacterIds) => setForm({ ...form, affectedCharacterIds })} /><LinesField label="Persistent effects" value={form.persistentEffects} onChange={(persistentEffects) => setForm({ ...form, persistentEffects })} /><button type="button" className="button button--primary" onClick={save}>{editingId ? 'Save memory' : 'Add memory'}</button></div>
    <div className="forge-timeline">{sorted.length === 0 ? <p className="forge-empty">The world has no recorded events yet.</p> : sorted.map((memory) => <article className="forge-timeline-event" key={idOf(memory)}><div className="forge-timeline-rail"><i /></div><div><span className="eyebrow">{asString(memory.occurredAt) || 'Undated'} · {nice(asString(memory.kind) || 'event')}</span><h3>{nameOf(memory)}</h3><p>{asString(memory.description)}</p><div className="forge-tag-row"><span>{nice(asString(memory.visibility) || 'common')}</span>{asStrings(memory.persistentEffects).map((effect) => <span key={effect}>{effect}</span>)}</div></div><EntityActions onEdit={() => edit(memory)} onDuplicate={() => edit(memory, true)} onDelete={() => onChange(memories.filter((candidate) => idOf(candidate) !== idOf(memory)))} /></article>)}</div>
  </>;
}

function TimeWeatherEditor({ document, onChange }: { document: JsonObject; onChange: (document: JsonObject) => void }) {
  const timeWeather = asObject(document.timeWeather);
  const seasons = asObjects(timeWeather.seasons);
  const update = (key: string, value: JsonValue) => onChange({ ...document, timeWeather: { ...timeWeather, [key]: value } });
  const updateSeason = (index: number, key: string, value: JsonValue) => update('seasons', seasons.map((season, itemIndex) => itemIndex === index ? { ...season, [key]: value } : season));
  return <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 09</span><h2>Time & Weather</h2></div><small>CALENDAR · SEASONS · WEATHER</small></header>
    <section className="forge-form-section"><h4>Time setup</h4><div className="forge-grid forge-grid--3"><SelectField label="Preset" value={asString(timeWeather.preset) || 'simple'} options={[{ value: 'simple', label: 'Simple' }, { value: 'custom', label: 'Custom' }]} onChange={(value) => update('preset', value)} /><SelectField label="Time progression" value={asString(timeWeather.mode) || 'tick'} options={[{ value: 'tick', label: 'Per input / tick' }, { value: 'realtime', label: 'Real time' }]} onChange={(value) => update('mode', value)} /><NumberField label="Minutes per input" min={1} value={asNumber(timeWeather.minutesPerInput, 1)} onChange={(value) => update('minutesPerInput', value)} /><NumberField label="Hours per world day" min={1} value={asNumber(timeWeather.hoursPerDay, 24)} onChange={(value) => update('hoursPerDay', value)} /><NumberField label="Simple day real minutes" min={1} value={asNumber(timeWeather.simpleDayRealMinutes, 20)} onChange={(value) => update('simpleDayRealMinutes', value)} /><NumberField label="Starting day" min={1} value={asNumber(timeWeather.startingDay, 1)} onChange={(value) => update('startingDay', value)} /><NumberField label="Starting hour" min={0} value={asNumber(timeWeather.startingHour, 8)} onChange={(value) => update('startingHour', value)} /></div><div className="forge-toggle-row"><ToggleField label="Pause when inactive" checked={asBoolean(timeWeather.pauseWhenInactive)} onChange={(value) => update('pauseWhenInactive', value)} /></div></section>
    <section className="forge-form-section"><h4>Seasons & calendar</h4><div className="forge-toggle-row"><ToggleField label="Seasons enabled" checked={asBoolean(timeWeather.seasonsEnabled)} onChange={(value) => update('seasonsEnabled', value)} /></div><div className="forge-season-grid">{seasons.map((season, index) => <article className="forge-season" key={idOf(season) || index}><header><strong>{asString(season.name) || `Season ${index + 1}`}</strong><button type="button" className="icon-button danger" title="Remove season" onClick={() => update('seasons', seasons.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></header><TextField label="Season name" value={asString(season.name)} onChange={(value) => updateSeason(index, 'name', value)} /><NumberField label="Length in days" min={1} value={asNumber(season.lengthDays, 1)} onChange={(value) => updateSeason(index, 'lengthDays', Math.max(1, value))} /><TextField label="Season weather rules" rows={4} value={asString(season.weatherPrompt)} onChange={(value) => updateSeason(index, 'weatherPrompt', value)} /></article>)}</div><button type="button" className="button button--secondary" onClick={() => update('seasons', [...seasons, { id: crypto.randomUUID(), name: 'New season', lengthDays: 30, weatherPrompt: '' }])}><Plus size={15} /> Add season</button></section>
    <section className="forge-form-section"><h4>Weather</h4><div className="forge-grid forge-grid--3"><SelectField label="Weather source" value={asString(timeWeather.weatherMode) || 'simulated'} options={[{ value: 'simulated', label: 'Simulated' }, { value: 'real_world', label: 'Real-world influenced' }]} onChange={(value) => update('weatherMode', value)} /><TextField label="Climate" value={asString(timeWeather.climate)} onChange={(value) => update('climate', value)} /><TextField label="Real-world location" value={asString(timeWeather.realWorldLocation)} onChange={(value) => update('realWorldLocation', value)} /><label className="forge-field"><span>Real-world influence: {Math.max(0, Math.min(100, asNumber(timeWeather.realWorldInfluence, 50)))}%</span><input type="range" min={0} max={100} value={Math.max(0, Math.min(100, asNumber(timeWeather.realWorldInfluence, 50)))} onChange={(event) => update('realWorldInfluence', Number(event.target.value))} /></label></div><TextField label="World weather rules" rows={6} value={asString(timeWeather.weatherPrompt)} onChange={(value) => update('weatherPrompt', value)} /></section>
    <div className="forge-inheritance"><span className="forge-lamp" /><div><strong>World time is inherited context</strong><p>Characters and scenes can reference this authored calendar, season and weather state without flattening it into prose.</p></div></div>
  </section>;
}

function ContextPreview({ document }: { document: JsonObject }) {
  const identity = asObject(document.identity); const rules = asObject(document.rules); const time = asObject(document.timeWeather);
  const groups: Array<[string, JsonObject[]]> = [['Species', asObjects(document.species)], ['Locations', asObjects(document.locations)], ['Factions', asObjects(document.factions)], ['Peoples & societies', asObjects(document.societies)], ['Families', asObjects(document.families)]];
  const counts = [['Species', asObjects(document.species).length], ['Places', asObjects(document.locations).length], ['Societies', asObjects(document.societies).length], ['Families', asObjects(document.families).length], ['Factions', asObjects(document.factions).length], ['Memories', asObjects(document.memories).length]];
  const seasons = asObjects(time.seasons).map((season) => asString(season.name)).filter(Boolean);
  return <aside className="forge-context"><div className="forge-context__sigil">{(asString(identity.name) || 'W').slice(0, 1).toUpperCase()}</div><span className="eyebrow">Living Reality Container</span><h2>{asString(identity.name) || 'Untitled world'}</h2><p>{asString(identity.description) || 'Define the reality that every character will grow inside.'}</p><div className="forge-context__facts">{asString(identity.genre) && <p><strong>Genre:</strong> {asString(identity.genre)}</p>}{asString(identity.tone) && <p><strong>Tone:</strong> {asString(identity.tone)}</p>}{asString(rules.technology) && <p><strong>Technology:</strong> {asString(rules.technology)}</p>}{asString(rules.magicPhysics) && <p><strong>Magic / physics:</strong> {asString(rules.magicPhysics)}</p>}<p><strong>Time:</strong> {asNumber(time.hoursPerDay, 24)}h day · {(asString(time.mode) || 'tick') === 'tick' ? `${asNumber(time.minutesPerInput, 1)}m/input` : 'real-time'}</p>{seasons.length > 0 && <p><strong>Seasons:</strong> {seasons.join(', ')}</p>}{asString(time.climate) && <p><strong>Climate:</strong> {asString(time.climate)}</p>}{groups.map(([label, items]) => items.length ? <p key={label}><strong>{label}:</strong> {items.map((item) => nameOf(item)).join(', ')}</p> : null)}</div><div className="forge-context__counts">{counts.map(([label, count]) => <span key={String(label)}><b>{count}</b>{label}</span>)}</div></aside>;
}

export function WorldForgeEditor({ asset }: { asset: LibraryAsset }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('identity');
  const [name, setName] = useState(asset.name);
  const [summary, setSummary] = useState(asset.summary);
  const [contentRating] = useState<ContentRating>(asset.contentRating ?? 'sfw');
  const [tags] = useState(asset.tags.join('\n'));
  const [visualTone] = useState<LibraryAsset['visualTone']>(asset.visualTone);
  const [document, setDocument] = useState<JsonObject>(() => structuredClone(asset.document ?? {}) as JsonObject);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const identity = asObject(document.identity); const lore = asObject(document.lore); const rules = asObject(document.rules);
  const locations = asObjects(document.locations); const species = asObjects(document.species); const factions = asObjects(document.factions); const societies = asObjects(document.societies); const families = asObjects(document.families); const memories = asObjects(document.memories);
  const markDocument = (next: JsonObject) => { setDocument(next); setDirty(true); setMessage(''); };
  const updateIdentity = (key: string, value: JsonValue) => { const next = updateObject(document, 'identity', key, value); if (key === 'name') setName(String(value)); if (key === 'description') setSummary(String(value).slice(0, 2000)); markDocument(next); };

  const payload = useMemo<LibraryAssetUpdate>(() => ({ name: name.trim(), summary: summary.trim(), contentRating, tags: tags.split('\n').map((tag) => tag.trim()).filter(Boolean), visualTone, document }), [contentRating, document, name, summary, tags, visualTone]);
  const save = useCallback(async () => { if (!payload.name) return setMessage('World name is required.'); setSaving(true); setMessage(''); try { await libraryApi.updateAsset(asset.id, payload); setDirty(false); setMessage('World saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'The world could not be saved.'); } finally { setSaving(false); } }, [asset.id, payload]);

  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }; window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', shortcut); return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', shortcut); }; }, [dirty, save]);

  return <div className="world-forge"><header className="forge-toolbar"><div><span className="eyebrow">World Forge · Root Object</span><h1>{name}</h1></div><div className="forge-toolbar__actions"><span className={dirty ? 'editor-dirty is-dirty' : 'editor-dirty'}>{dirty ? 'Unsaved world changes' : 'World root saved'}</span><button type="button" className="button button--secondary" onClick={() => navigate(`/asset/${asset.id}`)}>Cancel</button><button type="button" className="button button--primary" disabled={saving} onClick={() => void save()}><Save size={16} /> {saving ? 'Saving...' : 'Save world'}</button></div></header>
    <nav className="forge-tabs" aria-label="World editor sections">{tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav>
    <div className="forge-workbench"><main>
      {activeTab === 'identity' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 01</span><h2>Identity</h2></div><small>THE REALITY CONTAINER</small></header><div className="forge-grid forge-grid--3"><TextField label="World name" value={asString(identity.name) || name} onChange={(value) => updateIdentity('name', value)} /><TextField label="Genre" value={asString(identity.genre)} onChange={(value) => updateIdentity('genre', value)} /><TextField label="Tone" value={asString(identity.tone)} onChange={(value) => updateIdentity('tone', value)} /></div><TextField label="Description" rows={8} value={asString(identity.description)} onChange={(value) => updateIdentity('description', value)} /><div className="forge-inheritance"><span className="forge-lamp" /><div><strong>{asset.dependencyCount} connected records</strong><p>World-linked records remain connected to this root object and inherit relevant authored context.</p></div></div></section>}
      {activeTab === 'lore' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 02</span><h2>Lore</h2></div><small>HISTORY · CULTURE · FACT</small></header><TextField label="History" rows={7} value={asString(lore.history)} onChange={(value) => markDocument(updateObject(document, 'lore', 'history', value))} /><TextField label="Cultures" rows={6} value={asString(lore.cultures)} onChange={(value) => markDocument(updateObject(document, 'lore', 'cultures', value))} /><TextField label="Customs" rows={6} value={asString(lore.customs)} onChange={(value) => markDocument(updateObject(document, 'lore', 'customs', value))} /><LinesField label="Important facts" value={asStrings(lore.importantFacts)} onChange={(value) => markDocument(updateObject(document, 'lore', 'importantFacts', value))} /></section>}
      {activeTab === 'places' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 03</span><h2>Places</h2></div><small>REGIONS · SETTLEMENTS · LANDMARKS</small></header><LocationEditor value={document.locations} memories={memories} societies={societies} onChange={(value) => markDocument({ ...document, locations: value })} /></section>}
      {activeTab === 'people' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 04</span><h2>People of the world</h2></div><small>SPECIES · FACTIONS</small></header><div className="forge-split"><SimpleEntityEditor label="Species" value={document.species} onChange={(value) => markDocument({ ...document, species: value })} /><SimpleEntityEditor label="Faction" value={document.factions} onChange={(value) => markDocument({ ...document, factions: value })} /></div></section>}
      {activeTab === 'societies' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 05</span><h2>Peoples & Societies</h2></div><small>CLANS · TRIBES · HOUSEHOLDS · SETTLEMENTS</small></header><SocietyEditor value={document.societies} locations={locations} species={species} families={families} factions={factions} onChange={(value) => markDocument({ ...document, societies: value })} /></section>}
      {activeTab === 'families' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 06</span><h2>Family Trees</h2></div><small>KINSHIP · ADOPTION · GUARDIANSHIP</small></header><FamilyEditor value={document.families} onChange={(value) => markDocument({ ...document, families: value })} /></section>}
      {activeTab === 'memory' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 07</span><h2>Memory & Timeline</h2></div><small>EVENTS · CONSEQUENCES · PERSISTENT MEMORY</small></header><MemoryEditor value={document.memories} locations={locations} factions={factions} families={families} onChange={(value) => markDocument({ ...document, memories: value })} /></section>}
      {activeTab === 'rules' && <section className="forge-module"><header className="forge-module__title"><div><span className="eyebrow">World Module 08</span><h2>Rules</h2></div><small>TECHNOLOGY · SOCIETY · PHYSICS · CONSTRAINTS</small></header><TextField label="Technology" rows={6} value={asString(rules.technology)} onChange={(value) => markDocument(updateObject(document, 'rules', 'technology', value))} /><TextField label="Society" rows={6} value={asString(rules.society)} onChange={(value) => markDocument(updateObject(document, 'rules', 'society', value))} /><TextField label="Magic / physics" rows={6} value={asString(rules.magicPhysics)} onChange={(value) => markDocument(updateObject(document, 'rules', 'magicPhysics', value))} /><LinesField label="Constraints" value={asStrings(rules.constraints)} onChange={(value) => markDocument(updateObject(document, 'rules', 'constraints', value))} /></section>}
      {activeTab === 'time' && <TimeWeatherEditor document={document} onChange={markDocument} />}
    </main><ContextPreview document={document} /></div><footer className="forge-footer"><span role="status">{message}</span><small>Ctrl+S saves the world.</small></footer>
  </div>;
}
