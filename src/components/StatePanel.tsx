import { ArchiveX, CloudOff, LoaderCircle } from 'lucide-react';

export function LoadingState({ label = 'Opening the archive...' }: { label?: string }) {
  return <div className="state-panel"><LoaderCircle className="state-panel__spinner" /><strong>{label}</strong><span>The shelves are being arranged.</span></div>;
}

export function EmptyState({ search }: { search?: string }) {
  return <div className="state-panel"><ArchiveX /><strong>No records found</strong><span>{search ? `Nothing in the archive matches “${search}”.` : 'This shelf is waiting for its first entry.'}</span></div>;
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return <div className="state-panel state-panel--error"><CloudOff /><strong>The archive is out of reach</strong><span>Your records are safe. Orbis could not answer.</span>{retry && <button className="button button--secondary" onClick={retry}>Try again</button>}</div>;
}
