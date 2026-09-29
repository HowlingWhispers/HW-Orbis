import { useEffect, useId, useState } from 'react';
import { libraryApi } from '../api/client';
import type { SimulationPersona, SimulationPlace } from '../api/contracts';

interface PersonaPickerProps {
  targetId: string;
  targetName: string;
  initialPlaceId?: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSelect: (personaId: string, startingPlaceId: string) => void;
}

export function PersonaPicker({ targetId, targetName, initialPlaceId, busy, error = '', onCancel, onSelect }: PersonaPickerProps) {
  const titleId = useId();
  const [personas, setPersonas] = useState<SimulationPersona[]>([]);
  const [places, setPlaces] = useState<SimulationPlace[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
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

  return <section className="world-delete-review" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header>
      <div><span className="eyebrow">Set up simulation</span><h2 id={titleId}>Simulate {targetName}</h2></div>
      <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </header>
    <p>Choose who you are and where the simulation begins. The selected Place becomes the session's canonical starting anchor in Speculus.</p>
    {loading && <p role="status">Loading simulation choices...</p>}

    {!loading && personas.length === 0 && !loadError && <p role="status">No Personas are available. Create one or ask its owner to share it for use.</p>}
    {personas.length > 0 && <>
      <h3>Player Persona</h3>
      <fieldset className="world-delete-review__impact" disabled={busy}>
        <legend className="sr-only">Available Personas</legend>
        {personas.map((persona) => <label key={persona.id}>
          <input type="radio" name="simulation-persona" value={persona.id} checked={selectedPersonaId === persona.id} onChange={() => setSelectedPersonaId(persona.id)} />
          <span><strong>{persona.name}</strong>{persona.owned ? ' · Yours' : ' · Shared'}{persona.summary ? ` — ${persona.summary}` : ''}</span>
        </label>)}
      </fieldset>
    </>}

    {!loading && places.length === 0 && !loadError && <p role="status">No starting Places are available. Add a Place to this world before starting Speculus.</p>}
    {places.length > 0 && <>
      <h3>Starting Place</h3>
      <fieldset className="world-delete-review__impact" disabled={busy}>
        <legend className="sr-only">Available starting Places</legend>
        {places.map((place) => <label key={place.id}>
          <input type="radio" name="simulation-place" value={place.id} checked={selectedPlaceId === place.id} onChange={() => setSelectedPlaceId(place.id)} />
          <span><strong>{place.name}</strong>{place.isTarget ? ' · This Place' : ''}{place.kind ? ` · ${place.kind.replaceAll('-', ' ')}` : ''}{place.summary ? ` — ${place.summary}` : ''}</span>
        </label>)}
      </fieldset>
    </>}

    {(loadError || error) && <p className="form-message" role="alert">{loadError || error}</p>}
    <button type="button" className="button button--primary" disabled={busy || loading || !selectedPersonaId || !selectedPlaceId} onClick={() => onSelect(selectedPersonaId, selectedPlaceId)}>
      {busy ? 'Packaging...' : 'Start simulation'}
    </button>
  </section>;
}
