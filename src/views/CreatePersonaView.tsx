import { ArrowLeft, PenLine, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useSEO } from '../hooks/useSEO';

const blankPersona = {
  type: 'persona' as const,
  name: 'New Persona',
  summary: '',
  contentRating: 'sfw' as const,
  tags: [] as string[],
  visualTone: 'moon' as const,
  document: {
    identity: {
      displayName: '',
      species: '',
      age: '',
      pronouns: '',
      description: '',
    },
    appearance: '',
    personality: '',
    background: '',
    speech: '',
    preferences: [] as string[],
    skills: [] as string[],
    notes: '',
    personaSettings: {
      visibility: 'private',
      showInLibrary: false,
      allowUse: false,
      allowForking: false,
    },
  },
};

export function CreatePersonaView() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [working, setWorking] = useState<'manual' | 'coda' | ''>('');
  const [error, setError] = useState('');

  useSEO({
    title: 'Create Persona | Orbis',
    description: 'Create a reusable player Persona for Orbis and Speculus.',
    canonicalPath: '/personas/new',
  });

  const createPersona = async (withCoda: boolean) => {
    if (working) return;
    setWorking(withCoda ? 'coda' : 'manual');
    setError('');
    try {
      const persona = await libraryApi.createAsset(blankPersona);
      navigate(`/asset/${persona.id}/edit${withCoda ? '?coda=1' : ''}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not create the Persona.');
      setWorking('');
    }
  };

  if (authLoading) return <div className="page world-create-page"><p className="world-create-muted">Checking creator access...</p></div>;

  if (!user) return <div className="page world-create-page">
    <Link className="back-link" to="/library/persona"><ArrowLeft size={16} /> Back to Personas</Link>
    <section className="world-create-empty"><h1>Sign in to create a Persona</h1><p>Orbis needs your account so ownership and sharing controls stay attached to your Persona.</p></section>
  </div>;

  return <div className="page world-create-page">
    <Link className="back-link" to="/library/persona"><ArrowLeft size={16} /> Back to Personas</Link>
    <header className="world-create-hero">
      <span className="eyebrow">Persona creation</span>
      <h1>Create a reusable player identity</h1>
      <p>The Persona stores who you are. Each world or simulation instance keeps its own inventory, location, relationships and progression.</p>
    </header>

    {error && <div className="inline-error world-create-error" role="alert">{error}</div>}

    <section className="world-create-options" aria-label="Persona creation methods">
      <article className="world-create-card">
        <div className="world-create-card__icon"><PenLine size={22} /></div>
        <div><span className="eyebrow">Manual</span><h2>Start with a blank Persona</h2><p>Fill in identity, appearance, personality, background, speech, preferences and skills yourself.</p></div>
        <button className="button button--primary" type="button" disabled={Boolean(working)} onClick={() => void createPersona(false)}>{working === 'manual' ? 'Creating...' : 'Create manually'}</button>
      </article>

      <article className="world-create-card world-create-card--coda">
        <div className="world-create-card__icon"><Sparkles size={22} /></div>
        <div><span className="eyebrow">Coda assisted</span><h2>Create with Coda</h2><p>Open a private Persona directly beside Coda. Coda can help write the Persona, while sharing controls stay owner-only.</p></div>
        <button className="button button--primary" type="button" disabled={Boolean(working)} onClick={() => void createPersona(true)}>{working === 'coda' ? 'Preparing Coda...' : 'Create with Coda'}</button>
      </article>
    </section>
  </div>;
}
