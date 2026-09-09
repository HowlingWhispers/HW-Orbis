import { BadgeCheck, LogIn, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { discordLoginPath, useAuth } from '../auth/AuthContext';

const fallbackDiscordInviteUrl = (import.meta.env.VITE_DISCORD_INVITE_URL ?? '').trim();

export function VerificationView() {
  const { user } = useAuth();
  const [discordInviteUrl, setDiscordInviteUrl] = useState(fallbackDiscordInviteUrl);
  useEffect(() => {
    fetch('/api/config/public', { headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { discordInviteUrl?: string }) => setDiscordInviteUrl(data.discordInviteUrl?.trim() || fallbackDiscordInviteUrl))
      .catch(() => undefined);
  }, []);
  return (
    <div className="page verification-page">
      <section className="verification-panel">
        <span className="eyebrow">Protected shelves</span><h1>Get verified to continue</h1><p>Adult-rated Orbis records are limited to verified adult members of The Howling Whispers Discord. Until then, the Library keeps their details covered.</p>
        <div className="verification-steps">
          <div><UserRoundCheck /><span><strong>1. Join the Discord</strong><small>Become a member of The Howling Whispers community.</small></span></div>
          <div><ShieldCheck /><span><strong>2. Complete age verification</strong><small>Follow the verification instructions provided by the server team.</small></span></div>
          <div><BadgeCheck /><span><strong>3. Receive an accepted role</strong><small>The 18+ Access role, or an approved adult staff role, unlocks these shelves.</small></span></div>
          <div><LogIn /><span><strong>4. Sign in again</strong><small>Coda checks your current membership and roles through Discord.</small></span></div>
        </div>
        <div className="verification-actions">
          {discordInviteUrl && <a className="button button--primary" href={discordInviteUrl} target="_blank" rel="noreferrer">Open the Discord</a>}
          <a className="button button--discord" href={discordLoginPath('/verification')}>{user ? 'Refresh Discord access' : 'Sign in with Discord'}</a>
          <Link className="button button--ghost" to="/">Return to SFW shelves</Link>
        </div>
      </section>
    </div>
  );
}
