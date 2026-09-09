import { CheckCircle2, LogOut, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { discordLoginPath, useAuth } from '../auth/AuthContext';
import { deleteNovelAiSettings, getNovelAiSettings, saveNovelAiSettings, type NovelAiSettings } from '../api/provider-settings';
import { UserAvatar } from '../components/UserAvatar';
import { useI18n } from '../i18n/I18nContext';
import type { Locale } from '../i18n/translations';
import { useTheme, type ThemePreference } from '../theme/ThemeContext';

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
  useEffect(() => setDisplayName(user?.displayName ?? ''), [user]);
  useEffect(() => {
    if (!user) return;
    void getNovelAiSettings().then(setProvider).catch((error) => setProviderMessage(error instanceof Error ? error.message : 'Provider settings unavailable.'));
  }, [user]);

  if (loading) return <div className="page"><div className="account-panel">{t('Opening your profile...')}</div></div>;
  if (!user) return (
    <div className="page account-page"><section className="account-panel account-panel--signed-out"><span className="eyebrow">{t('Your Coda identity')}</span><h1>{t('Sign in with Discord')}</h1><p>{t('Your Discord account establishes permanent ownership of everything you create.')}</p><a className="button button--discord" href={discordLoginPath('/account')}>{t('Continue with Discord')}</a></section></div>
  );

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('');
    try { await updateDisplayName(displayName); setMessage(t('Display name saved.')); }
    catch (error) { setMessage(error instanceof Error ? error.message : t('Could not save your name.')); }
    finally { setSaving(false); }
  };

  const themeOptions: Array<{ value: ThemePreference; label: string; description: string }> = [
    { value: 'auto', label: t('Auto'), description: t('Follow your device light or dark setting.') },
    { value: 'dark', label: t('Dark'), description: t('Use Coda’s warm dark library theme.') },
    { value: 'light', label: t('Light'), description: t('Use Coda’s warm ivory library theme.') },
  ];

  const saveProvider = async (event: React.FormEvent) => {
    event.preventDefault(); setProviderSaving(true); setProviderMessage('');
    try {
      const next = await saveNovelAiSettings(novelAiToken, provider.model);
      setProvider(next); setNovelAiToken(''); setProviderMessage('NovelAI connection saved for Speculus.');
    } catch (error) { setProviderMessage(error instanceof Error ? error.message : 'Could not save NovelAI settings.'); }
    finally { setProviderSaving(false); }
  };

  const removeProvider = async () => {
    setProviderSaving(true); setProviderMessage('');
    try { setProvider(await deleteNovelAiSettings()); setNovelAiToken(''); setProviderMessage('NovelAI connection removed.'); }
    catch (error) { setProviderMessage(error instanceof Error ? error.message : 'Could not remove NovelAI settings.'); }
    finally { setProviderSaving(false); }
  };

  return (
    <div className="page account-page">
      <section className="account-panel">
        <div className="account-identity"><UserAvatar user={user} size={72} /><div><span className="eyebrow">{t('Signed in through Discord')}</span><h1>{user.displayName}</h1><p>@{user.discordUsername}</p></div></div>
        <form className="profile-form" onSubmit={save}><label htmlFor="display-name">{t('Coda display name')}</label><div><input id="display-name" value={displayName} minLength={2} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} /><button className="button button--primary" disabled={saving || displayName.trim() === user.displayName}>{saving ? t('Saving...') : t('Save name')}</button></div><small>{t('This changes the author name shown on all your creations. Ownership stays tied to your Discord ID.')}</small>{message && <p className="form-message" role="status">{message}</p>}</form>

        <form className="profile-form" onSubmit={saveProvider}>
          <label htmlFor="novelai-token">NovelAI for Speculus</label>
          <div>
            <input id="novelai-token" type="password" autoComplete="off" value={novelAiToken} minLength={16} maxLength={4096} onChange={(event) => setNovelAiToken(event.target.value)} placeholder={provider.configured ? 'Token saved. Paste to replace it.' : 'Paste your NovelAI access token'} />
            <select aria-label="NovelAI model" value={provider.model} onChange={(event) => setProvider({ ...provider, model: event.target.value as NovelAiSettings['model'] })}>
              <option value="xialong-v1">Xialong</option>
              <option value="glm-4-6">GLM 4.6</option>
            </select>
            <button className="button button--primary" disabled={providerSaving || novelAiToken.trim().length < 16}>{providerSaving ? 'Saving...' : provider.configured ? 'Replace token' : 'Save token'}</button>
            {provider.configured && <button className="button button--ghost" type="button" disabled={providerSaving} onClick={() => void removeProvider()}>Remove</button>}
          </div>
          <small>The token is encrypted in Orbis and never sent to the Speculus browser or service. Speculus receives only a temporary generation grant.</small>
          {providerMessage && <p className="form-message" role="status">{providerMessage}</p>}
        </form>

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

        <div className="permission-card">
          {user.permissions.canCreate ? <CheckCircle2 /> : <ShieldAlert />}
          <div><strong>{user.permissions.canCreate ? t('Verified creator') : t('Safe browsing access')}</strong><p>{user.permissions.canCreate ? t('You can view adult records and create new work. You can always edit records you own.') : t('You can browse SFW records and still edit records you own. Restricted cards lead to the verification guide.')}</p></div>
        </div>
        <button className="button button--ghost" onClick={() => void logout()}><LogOut size={16} /> {t('Sign out')}</button>
      </section>
    </div>
  );
}
