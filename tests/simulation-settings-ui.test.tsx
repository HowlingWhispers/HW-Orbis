import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationEngineSetting } from '../src/components/SimulationEngineSetting';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('engine preference UI', () => {
  it('loads the saved account choice and explicitly saves changes', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ engine: 'v1', available: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ engine: 'v2', available: true })));
    render(<SimulationEngineSetting />);
    const select = await screen.findByLabelText('Simulation engine');
    await vi.waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save engine' }));
    expect(await screen.findByText(/Saved. New simulations will open Speculus V2/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenLastCalledWith('/api/simulation-settings', expect.objectContaining({ method: 'PUT', body: '{"engine":"v2"}' }));
  });
  it('does not enable an unsaveable selector before installation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ engine: 'v1', available: false })));
    render(<SimulationEngineSetting />);
    expect(await screen.findByText(/Preferences are awaiting installation/)).toBeInTheDocument();
    expect(screen.getByLabelText('Simulation engine')).toBeDisabled();
  });
});
