import { useEffect, useId, useMemo, useState } from 'react';
import { libraryApi } from '../api/client';
import { stageSimulationLaunchSetup } from '../api/simulation-launch-setup';
import type { SimulationPersona, SimulationPlace, SimulationTone } from '../api/contracts';

interface PersonaPickerProps {
  targetId: string;
  targetName: string;
  initialPlaceId?: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSelect: (personaId: string, startingPlaceId?: string) => void;
}

const toneOptions: Array<{ value: SimulationTone; label: string; help: string }> = [
  { value: 'world-default', label: 'World default', help: 'Follow the world and character canon without adding a special content filter.' },
  { value: 'family-friendly', label: 'Family-friendly', help: 'Keep the session suitable for general audiences and avoid sexual or graphic material.' },
  { value: 'mature', label: 'Mature', help: 'Allow serious themes, stronger language and non-sexual violence without explicit sexual content.' },
  { value: 'adult-erotic', label: 'Adult / erotic (18+)', help: 'Allow adult erotic focus. This requires 18+ access and a Persona whose age is explicitly 18 or older.' },
];

function parseFocusTags(value: string) {
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
}

export function PersonaPicker({ targetId, targetName, initialPlaceId, busy, error = '', onCancel, onSelect }: PersonaPickerProps) {
  const titleId = useId();
  const [personas, setPersonas] = useState<SimulationPersona[]>([]);
  const [places, setPlaces] = useState<SimulationPlace[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [tone, setTone] = useState<SimulationTone>('world-default');
  const [focusTags, setFocusTags] = useState('');
  const [direction, setDirection] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      libraryApi.listSimulationPersonas(controller.signal),
      libraryApi.listSimulationPlaces(targetId, controller.signal),
    ])
      .then(([personaItems, placeItems]) => {
        setPersonas(personaItems);
        setPlaces(placeItems);
        if (personaItems.length === 1) setSelectedPersonaId(personaItems[0].id);
        // A world with zero Places is a valid launch: clear any Place selected
        // for a previous target rather than carrying a stale anchor across.
        if (placeItems.length === 0) {
          setSelectedPlaceId('');
          return;
        }
        const preferredPlace = placeItems.find((place) => place.id === initialPlaceId)
          ?? placeItems.find((place) => place.isTarget)
          ?? (placeItems.length === 1 ? placeItems[0] : undefined);
        if (preferredPlace) setSelectedPlaceId(preferredPlace.id);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setLoadError(cause instanceof Error ? cause.message : 'Orbis could not load the simulation setup.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [initialPlaceId, targetId]);

  const selectedPersona = useMemo(() => personas.find((persona) => persona.id === selectedPersonaId), [personas, selectedPersonaId]);
  const selectedPlace = useMemo(() => places.find((place) => place.id === selectedPlaceId), [places, selectedPlaceId]);

  useEffect(() => {
    if (tone === 'adult-erotic' && selectedPersona && !selectedPersona.adultToneEligible) setTone('world-default');
  }, [selectedPersona, tone]);

  const selectedTone = toneOptions.find((option) => option.value === tone) ?? toneOptions[0];
  // A canonical starting Place is only required when the world actually has
  // Places. With none defined, the launch proceeds without a location anchor
  // rather than substituting an unrelated one.
  const placeRequired = places.length > 0;
  const canStart = !busy && !loading && Boolean(selectedPersonaId) && (!placeRequired || Boolean(selectedPlaceId));

  const start = () => {
    if (!canStart) return;
    stageSimulationLaunchSetup({
      tone,
      focusTags: parseFocusTags(focusTags),
      direction: direction.trim(),
    });
    onSelect(selectedPersonaId, placeRequired ? selectedPlaceId : undefined);
  };

  return <section className="world-delete-review" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header>
      <div><span className="eyebrow">Set up simulation</span><h2 id={titleId}>Simulate {targetName}</h2></div>
      <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </header>
    <p>{placeRequired
      ? 'Choose the Persona, canonical starting Place, and launch-only tone for this Speculus session. Tone, tags and direction steer the simulation without changing Orbis canon.'
      : 'Choose the Persona and launch-only tone for this Speculus session. Tone, tags and direction steer the simulation without changing Orbis canon.'}</p>
    {loading && <p role="status">Loading simulation choices...</p>}

    {!loading && personas.length === 0 && !loadError && <p role="status">No Personas are available. Create one or ask its owner to share it for use.</p>}
    {personas.length > 0 && <label className="world-delete-review__confirm">
      <span><strong>Player Persona</strong></span>
      <select aria-label="Player Persona" disabled={busy} value={selectedPersonaId} onChange={(event) => setSelectedPersonaId(event.target.value)}>
        <option value="">Choose a Persona...</option>
        {personas.map((persona) => <option key={persona.id} value={persona.id}>
          {persona.name}{persona.owned ? ' · Yours' : ' · Shared'}{persona.age !== undefined ? ` · age ${persona.age}` : ''}
        </option>)}
      </select>
      {selectedPersona?.summary && <small>{selectedPersona.summary}</small>}
    </label>}

    {!loading && places.length === 0 && !loadError && <p role="status">No starting Place is defined for this world. The simulation will begin without a location anchor.</p>}
    {places.length > 0 && <label className="world-delete-review__confirm">
      <span><strong>Starting Place</strong></span>
      <select aria-label="Starting Place" disabled={busy} value={selectedPlaceId} onChange={(event) => setSelectedPlaceId(event.target.value)}>
        <option value="">Choose a starting Place...</option>
        {places.map((place) => <option key={place.id} value={place.id}>
          {place.name}{place.isTarget ? ' · This Place' : ''}{place.kind ? ` · ${place.kind.replaceAll('-', ' ')}` : ''}
        </option>)}
      </select>
      {selectedPlace?.summary && <small>{selectedPlace.summary}</small>}
    </label>}

    <label className="world-delete-review__confirm">
      <span><strong>Content / tone</strong></span>
      <select aria-label="Content / tone" disabled={busy || !selectedPersonaId} value={tone} onChange={(event) => setTone(event.target.value as SimulationTone)}>
        {toneOptions.map((option) => <option key={option.value} value={option.value} disabled={option.value === 'adult-erotic' && !selectedPersona?.adultToneEligible}>
          {option.label}{option.value === 'adult-erotic' && selectedPersona && !selectedPersona.adultToneEligible ? ' · unavailable for this Persona' : ''}
        </option>)}
      </select>
      <small>{selectedTone.help}</small>
    </label>

    <label className="world-delete-review__confirm">
      <span><strong>Focus tags</strong> <small>Optional, comma-separated</small></span>
      <input disabled={busy} value={focusTags} onChange={(event) => setFocusTags(event.target.value)} maxLength={500} placeholder="family, slice-of-life, ranger work, slow pace" autoComplete="off" />
    </label>

    <label className="world-delete-review__confirm">
      <span><strong>Simulation direction</strong> <small>Optional launch-only prompt</small></span>
      <textarea disabled={busy} value={direction} onChange={(event) => setDirection(event.target.value)} maxLength={4000} rows={4} placeholder="Describe what this session should focus on, the desired pacing, atmosphere, relationships, or kinds of events to foreground." />
      <small>{direction.length}/4000 · This does not rewrite world or character canon.</small>
    </label>

    {(loadError || error) && <p className="form-message" role="alert">{loadError || error}</p>}
    <button type="button" className="button button--primary" disabled={!canStart} onClick={start}>
      {busy ? 'Packaging...' : 'Start simulation'}
    </button>
  </section>;
}
