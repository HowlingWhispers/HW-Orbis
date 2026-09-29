import type { SimulationLaunchSetup } from './contracts';

let pendingSetup: SimulationLaunchSetup | undefined;

export function stageSimulationLaunchSetup(setup: SimulationLaunchSetup) {
  pendingSetup = {
    tone: setup.tone,
    focusTags: setup.focusTags.map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    direction: setup.direction.trim(),
  };
}

export function consumeSimulationLaunchSetup() {
  const setup = pendingSetup;
  pendingSetup = undefined;
  return setup;
}
