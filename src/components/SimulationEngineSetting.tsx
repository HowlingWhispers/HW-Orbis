import { useEffect, useState } from 'react';
import { getSimulationSettings, saveSimulationSettings, type SimulationSettings } from '../api/simulation-settings';

export function SimulationEngineSetting() {
  const [saved, setSaved] = useState<SimulationSettings | null>(null);
  const [engine, setEngine] = useState<SimulationSettings['engine']>('v1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void getSimulationSettings().then((value) => {
      if (!active) return;
      setSaved(value); setEngine(value.engine);
      if (!value.available) setMessage('Preferences are awaiting installation. Simulate continues to open V1.');
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Preferences unavailable.'); });
    return () => { active = false; };
  }, []);

  return <form className="profile-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const value = await saveSimulationSettings(engine);
      setSaved(value); setEngine(value.engine);
      setMessage(`Saved. New simulations will open Speculus ${value.engine.toUpperCase()}. Existing sessions are unchanged.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the engine preference.'); }
    finally { setBusy(false); }
  }}>
    <label htmlFor="simulation-engine">Simulation engine</label>
    <div>
      <select id="simulation-engine" value={engine} disabled={!saved?.available || busy} onChange={(event) => setEngine(event.target.value as SimulationSettings['engine'])}>
        <option value="v1">Speculus V1 · Stable</option>
        <option value="v2">Speculus V2 · Experimental</option>
      </select>
      <button className="button button--primary" disabled={!saved?.available || busy || saved.engine === engine}>{busy ? 'Saving...' : 'Save engine'}</button>
    </div>
    <small>Saved to your Orbis account. Controls every Simulate button: V1 opens /, V2 opens /v2. Sessions and exports remain separate. NovelAI credentials stay in Orbis.</small>
    {message && <p className="form-message" role="status">{message}</p>}
  </form>;
}
