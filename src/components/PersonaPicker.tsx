import { useEffect, useId, useState } from 'react';
import { libraryApi } from '../api/client';
import type { SimulationPersona } from '../api/contracts';

interface PersonaPickerProps {
  targetName: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSelect: (personaId: string) => void;
}

export function PersonaPicker({ targetName, busy, error = '', onCancel, onSelect }: PersonaPickerProps) {
  const titleId = useId();
  const [personas, setPersonas] = useState<SimulationPersona[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    libraryApi.listSimulationPersonas(controller.signal)
      .then((items) => {
        setPersonas(items);
        if (items.length === 1) setSelectedId(items[0].id);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setLoadError(cause instanceof Error ? cause.message : 'Orbis could not load your Personas.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return <section className="world-delete-review" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header>
      <div><span className="eyebrow">Choose your player Persona</span><h2 id={titleId}>Simulate {targetName}</h2></div>
      <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </header>
    <p>Select the Persona who enters this simulation. Speculus receives its canonical identity; session state remains separate.</p>
    {loading && <p role="status">Loading Personas...</p>}
    {!loading && personas.length === 0 && !loadError && <p role="status">No Personas are available. Create one or ask its owner to share it for use.</p>}
    {personas.length > 0 && <fieldset className="world-delete-review__impact" disabled={busy}>
      <legend className="sr-only">Available Personas</legend>
      {personas.map((persona) => <label key={persona.id}>
        <input type="radio" name="simulation-persona" value={persona.id} checked={selectedId === persona.id} onChange={() => setSelectedId(persona.id)} />
        <span><strong>{persona.name}</strong>{persona.owned ? ' · Yours' : ' · Shared'}{persona.summary ? ` — ${persona.summary}` : ''}</span>
      </label>)}
    </fieldset>}
    {(loadError || error) && <p className="form-message" role="alert">{loadError || error}</p>}
    <button type="button" className="button button--primary" disabled={busy || loading || !selectedId} onClick={() => onSelect(selectedId)}>
      {busy ? 'Packaging...' : 'Start simulation'}
    </button>
  </section>;
}
