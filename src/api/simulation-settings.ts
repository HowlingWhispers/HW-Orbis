export type SimulationSettings = { engine: 'v1' | 'v2' | 'v3'; available: boolean };

async function readResponse(response: Response): Promise<SimulationSettings> {
  const body = await response.json() as SimulationSettings & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Could not load simulation preferences.');
  if (body.engine !== 'v1' && body.engine !== 'v2' && body.engine !== 'v3') throw new Error('Invalid simulation preference response.');
  return body;
}

export async function getSimulationSettings() {
  return readResponse(await fetch('/api/simulation-settings', { credentials: 'include', headers: { Accept: 'application/json' } }));
}

export async function saveSimulationSettings(engine: SimulationSettings['engine']) {
  return readResponse(await fetch('/api/simulation-settings', {
    method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine }),
  }));
}
