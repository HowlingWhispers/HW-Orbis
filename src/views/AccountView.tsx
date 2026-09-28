import { CheckCircle2, Download, LogOut, ShieldAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { discordLoginPath, useAuth } from '../auth/AuthContext';
import { addAllowedDiscordUser, deleteNovelAiSettings, getAllowedDiscordUsers, getNovelAiSettings, removeAllowedDiscordUser, saveNovelAiSettings, setNovelAiSharedUse, type AllowedDiscordUser, type NovelAiSettings } from '../api/provider-settings';
import { downloadAccountArchive, uploadArchive } from '../api/archive-transfer';
import { UserAvatar } from '../components/UserAvatar';
import { useI18n } from '../i18n/I18nContext';
import type { Locale } from '../i18n/translations';
import { useTheme, type ThemePreference } from '../theme/ThemeContext';
import { useSEO } from '../hooks/useSEO';

export function AccountView() {
  const { user, loading, updateDisplayName, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const { preference: theme, setPreference: setTheme } = useTheme();
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<NovelAiSettings>({ configured: false, model: 'xialong-v1' });
  const [novelAiToken, setNovelAiToken] = useState('');
  const [providerMessage, setProviderMessage] = useState('');
  const [providerSaving, setProviderSaving] = useState(false);
  const [sharedUse, setSharedUse] = useState(false);
  const [sharedUseSaving, setSharedUseSaving] = useState(false);
  const [sharedUseMessage, setSharedUseMessage] = useState('');
  // Absent means the server has not reported the flag yet, so the tick starts
  // off rather than flashing on before consent is actually known.
  const [sharedUseUnavailable, setSharedUseUnavailable] = useState(false);
  const [trustedUsers, setTrustedUsers] = useState<AllowedDiscordUser[]>([]);
  const [trustedIdDraft, setTrustedIdDraft] = useState('');
  const [trustedSaving, setTrustedSaving] = useState(false);
  const [trustedMessage, setTrustedMessage] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState('');
  const archiveInput = useRef<HTMLInputElement>(null);

  useSEO({
    title: 'Your Account | Orbis — Library of Howling Whispers',
    description: 'Manage your Orbis account, NovelAI integration for Speculus, and account settings.',
    canonicalPath: '/account',
    noindex: true,
    nofollow: true,
  });

  useEffect(() => setDisplayName(user?.displayName ?? ''), [user]);
  useEffect(() => {
    if (!user) return;
    void getNovelAiSettings()
      .then((next) => {
        setProvider(next);
        setSharedUse(Boolean(next.sharedUse));
        setSharedUseUnavailable(next.sharedUseAvailable === false);
      })
      .catch((error) => setProviderMessage(error instanceof Error ? error.message : 'Provider settings unavailable.'));
    void getAllowedDiscordUsers()
      .then((next) => { setTrustedUsers(next.allowed); if (next.available === false) setTrustedMessage(t('Trusted Discord users are not installed yet.')); })
      .catch(() => setTrustedUsers([]));
  }, [user]);

  const addTrustedUser = async () => {
    const discordId = trustedIdDraft.trim();
    if (!/^[0-9]{17,20}$/.test(discordId)) {
      setTrustedMessage(t('Use an exact Discord user ID: 17 to 20 digits.'));
      return;
    }
    setTrustedSaving(true);
    setTrustedMessage('');
    try {
      const next = await addAllowedDiscordUser(discordId);
      setTrustedUsers(next.allowed);
      setTrustedIdDraft('');
      setTrustedMessage(t('That account may now be answered by your connection.'));
    } catch (error) {
      setTrustedMessage(error instanceof Error ? error.message : 'Orbis could not save that account.');
    } finally {
      setTrustedSaving(false);
    }
  };

  const dropTrustedUser = async (discordId: string) => {
    setTrustedSaving(true);
    setTrustedMessage('');
    try {
      const next = await removeAllowedDiscordUser(discordId);
      setTrustedUsers(next.allowed);
      setTrustedMessage(t('That account can no longer be answered by your connection.'));
    } catch (error) {
      setTrustedMessage(error instanceof Error ? error.message : 'Orbis could not remove that account.');
    } finally {
      setTrustedSaving(false);
    }
  };

  const toggleSharedUse = async (next: boolean) => {
    setSharedUseSaving(true);
    setSharedUseMessage('');
    // Optimistic, and rolled back if the server refuses so the tick can never
    // show consent that was not actually stored.
    setSharedUse(next);
    try {
      const result = await setNovelAiSharedUse(next);
      setSharedUse(result.sharedUse);
      setSharedUseMessage(result.sharedUse ? t('Coda may now use this connection for members without a key.') : t('Coda will no longer use this connection for anyone else.'));
    } catch (error) {
      setSharedUse(!next);
      setSharedUseMessage(error instanceof Error ? error.message : 'Orbis could not save that choice.');
    } finally {
      setSharedUseSaving(false);
    }
  };

  if (loading) return <div className="page"><div className="account-panel">{t('Opening your profile...')}</div></div>;
  if (!user) return (
    <div className="page account-page"><section className="account-panel account-panel--signed-out"><span className="eyebrow">{t('Your Orbis identity')}</span><h1>{t('Sign in with Discord')}</h1><p>{t('Your Discord account establishes permanent ownership of everything you create.')}</p><a className="button button--discord" href={discordLoginPath('/account')}>{t('Continue with Discord')}</a></section></div>
  );

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('');
    try { await updateDisplayName(displayName); setMessage(t('Display name saved.')); }
    catch (error) { setMessage(error instanceof Error ? error.message : t('Could not save your name.')); }
    finally { setSaving(false); }
  };

  const themeOptions: Array<{ value: ThemePreference; label: string; description: string }> = [
    { value: 'auto', label: t('Auto'), description: t('Follow your device light or dark setting.') },
    { value: 'dark', label: t('Dark'), description: t('Use Orbis’s warm dark library theme.') },
    { value: 'light', label: t('Light'), description: t('Use Orbis’s warm ivory library theme.') },
  ];

  const saveProvider = async (event: React.FormEvent) => {
    event.preventDefault(); setProviderSaving(true); setProviderMessage('');
    try {
      const next = await saveNovelAiSettings(novelAiToken, provider.model);
      setProvider(next); setNovelAiToken(''); setProviderMessage('NovelAI connection saved for Speculus and Coda Assistant.');
    } catch (error) { setProviderMessage(error instanceof Error ? error.message : 'Could not save NovelAI settings.'); }
    finally { setProviderSaving(false); }
  };

  const removeProvider = async () => {
    setProviderSaving(true); setProviderMessage('');
    try { setProvider(await deleteNovelAiSettings()); setNovelAiToken(''); setProviderMessage('NovelAI connection removed.'); }
    catch (error) { setProviderMessage(error instanceof Error ? error.message : 'Could not remove NovelAI settings.'); }
    finally { setProviderSaving(false); }
  };

  const downloadEverything = async () => {
    setTransferBusy(true); setTransferMessage('');
    try { await downloadAccountArchive(); setTransferMessage('Your complete Orbis archive was downloaded. Keep it somewhere private.'); }
    catch (error) { setTransferMessage(error instanceof Error ? error.message : 'Could not download your Orbis archive.'); }
    finally { setTransferBusy(false); }
  };

  const importEverything = async (file: File) => {
    if (!window.confirm(`Upload “${file.name}” to Orbis? The archive will be checked before anything is imported.`)) return;
    setTransferBusy(true); setTransferMessage('Checking archive...');
    try {
      const result = await uploadArchive(file);
      setTransferMessage(`${result.imported} SPC record${result.imported === 1 ? '' : 's'} imported successfully.`);
    } catch (error) { setTransferMessage(error instanceof Error ? error.message : 'Could not upload this Orbis archive.'); }
    finally { setTransferBusy(false); if (archiveInput.current) archiveInput.current.value = ''; }
  };

  return (
    <div className="page account-page">
      <section className="account-panel">
        <div className="account-identity"><UserAvatar user={user} size={72} /><div><span className="eyebrow">{t('Signed in through Discord')}</span><h1>{user.displayName}</h1><p>@{user.discordUsername}</p></div></div>
        <form className="profile-form" onSubmit={save}><label htmlFor="display-name">{t('Orbis display name')}</label><div><input id="display-name" value={displayName} minLength={2} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} /><button className="button button--primary" disabled={saving || displayName.trim() === user.displayName}>{saving ? t('Saving...') : t('Save name')}</button></div><small>{t('This changes the author name shown on all your creations. Ownership stays tied to your Discord ID.')}</small>{message && <p className="form-message" role="status">{message}</p>}</form>

        <form className="profile-form" onSubmit={saveProvider}>
          <label htmlFor="novelai-token">NovelAI for Speculus & Coda</label>
          <div>
            <input id="novelai-token" type="password" autoComplete="off" value={novelAiToken} minLength={16} maxLength={4096} onChange={(event) => setNovelAiToken(event.target.value)} placeholder={provider.configured ? 'Token saved. Paste to replace it.' : 'Paste your NovelAI access token'} />
            <select aria-label="NovelAI model" value={provider.model} onChange={(event) => setProvider({ ...provider, model: event.target.value as NovelAiSettings['model'] })}>
              <option value="xialong-v1">Xialong</option>
              <option value="glm-4-6">GLM 4.6</option>
            </select>
            <button className="button button--primary" disabled={providerSaving || novelAiToken.trim().length < 16}>{providerSaving ? 'Saving...' : provider.configured ? 'Replace token' : 'Save token'}</button>
            {provider.configured && <button className="button button--ghost" type="button" disabled={providerSaving} onClick={() => void removeProvider()}>Remove</button>}
          </div>
          <small>The token is encrypted in Orbis and never exposed to the browser. Speculus receives only a temporary generation grant; Coda Assistant uses the encrypted token through the Orbis API.</small>
          {providerMessage && <p className="form-message" role="status">{providerMessage}</p>}
        </form>

        <div className="profile-form coda-shared-use">
          <p className="coda-shared-use__warning" role="note">
            <strong>{t('Please read this before ticking the box.')}</strong>{' '}
            {t('While this is on, the people you list below will have their Discord messages answered using your NovelAI connection. Your plan has unlimited text, so this does not cost you anything, but the requests are made from your account — which means your account is what absorbs any rate limiting or provider block. They are never shown your key, and they are never told that yours was used. Add only Discord IDs you actually trust, and remove anyone at any time.')}
          </p>
          <label className="coda-shared-use__label" htmlFor="novelai-shared-use">
            {t('Allow my NovelAI connection to help power Discord Coda')}
          </label>
          <div className="coda-shared-use__row">
            <input
              id="novelai-shared-use"
              type="checkbox"
              checked={sharedUse}
              disabled={!provider.configured || sharedUseUnavailable || sharedUseSaving}
              onChange={(event) => void toggleSharedUse(event.target.checked)}
            />
            <span className="coda-shared-use__state" aria-live="polite">{sharedUseSaving ? t('Saving...') : sharedUse ? t('Enabled') : t('Off')}</span>
          </div>
          <small>
            {provider.configured
              ? t('Off by default, and on its own it still shares with nobody. Your connection only answers the Discord accounts you add below.')
              : t('Save a NovelAI connection above first. Your token is never shared or displayed, not even to you.')}
          </small>

          <div className="coda-shared-use__trusted">
            <span className="coda-shared-use__label">{t('Discord accounts you trust')}</span>
            <form
              className="coda-shared-use__add"
              onSubmit={(event) => { event.preventDefault(); void addTrustedUser(); }}
            >
              <input
                aria-label={t('Discord user ID')}
                value={trustedIdDraft}
                onChange={(event) => setTrustedIdDraft(event.target.value)}
                placeholder="123456789012345678"
                inputMode="numeric"
                pattern="[0-9]{17,20}"
                maxLength={20}
                disabled={!provider.configured || trustedSaving}
              />
              <button className="button" type="submit" disabled={!provider.configured || trustedSaving || !/^[0-9]{17,20}$/.test(trustedIdDraft.trim())}>
                {trustedSaving ? t('Adding...') : t('Trust this account')}
              </button>
            </form>
            {trustedMessage && <p className="form-message" role="status">{trustedMessage}</p>}
            {trustedUsers.length === 0
              ? <small>{t('Nobody yet. With this list empty, your connection is never used for anyone else.')}</small>
              : (
                <ul className="coda-shared-use__list">
                  {trustedUsers.map((entry) => (
                    <li key={entry.discordId}>
                      <code>{entry.discordId}</code>
                      <button
                        className="button button--ghost"
                        type="button"
                        disabled={trustedSaving}
                        onClick={() => void dropTrustedUser(entry.discordId)}
                      >
                        {t('Remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
          {sharedUseMessage && <p className="form-message" role="status">{sharedUseMessage}</p>}
        </div>

        <div className="profile-form language-setting">
          <label htmlFor="interface-language">{t('Interface language')}</label>
          <div>
            <select id="interface-language" value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
          <small>{t('The choice is saved on this device. User-authored worlds, characters and roleplay text are not translated automatically.')}</small>
        </div>

        <div className="profile-form theme-setting">
          <label>{t('Appearance')}</label>
          <div className="theme-setting__options" role="radiogroup" aria-label={t('Appearance')}>
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                className={`theme-option ${theme === option.value ? 'is-active' : ''}`}
                onClick={() => setTheme(option.value)}
              >
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
          <small>{t('The choice is saved on this device. Auto follows your operating system setting.')}</small>
        </div>

        <div className="profile-form archive-transfer">
          <label>World and SPC transfers</label>
          <div>
            <button className="button button--primary" type="button" disabled={transferBusy} onClick={() => void downloadEverything()}><Download size={16} /> Download everything</button>
            <button className="button button--secondary" type="button" disabled={transferBusy || !user.permissions.canCreate} onClick={() => archiveInput.current?.click()}><Upload size={16} /> Upload archive</button>
            <input
              ref={archiveInput}
              className="archive-transfer__input"
              type="file"
              accept=".json,.orbis.json,application/octet-stream"
              disabled={transferBusy || !user.permissions.canCreate}
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void importEverything(file); }}
            />
          </div>
          <small>Downloads include your authored records, world links and permanent SPC identities. Passwords, provider tokens and Discord sessions are never included. Uploads are checksum-verified and all-or-nothing. Keep archives private and never commit an unencrypted archive to a public Git repository.</small>
          {transferMessage && <p className="form-message" role="status">{transferMessage}</p>}
        </div>

        <div className="permission-card">
          {user.permissions.canCreate ? <CheckCircle2 /> : <ShieldAlert />}
          <div><strong>{user.permissions.canCreate ? t('Verified creator') : t('Safe browsing access')}</strong><p>{user.permissions.canCreate ? t('You can view adult records and create new work. You can always edit records you own.') : t('You can browse SFW records and still edit records you own. Restricted cards lead to the verification guide.')}</p></div>
        </div>
        <button className="button button--ghost" onClick={() => void logout()}><LogOut size={16} /> {t('Sign out')}</button>
      </section>
    </div>
  );
}
