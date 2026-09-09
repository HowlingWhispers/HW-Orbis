type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

const asObject = (value: JsonValue | undefined): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asString = (value: JsonValue | undefined) => typeof value === 'string' ? value : '';
const asBoolean = (value: JsonValue | undefined, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export function WorldSettingsPanel({ document, onChange }: { document: JsonObject; onChange: (document: JsonObject) => void }) {
  const settings = asObject(document.worldSettings);
  const visibility = asString(settings.visibility) || 'public';
  const showInLibrary = asBoolean(settings.showInLibrary, true);
  const allowForking = asBoolean(settings.allowForking, false);
  const update = (key: string, value: JsonValue) => onChange({
    ...document,
    worldSettings: { ...settings, [key]: value },
  });

  return <section className="forge-module">
    <header className="forge-module__title">
      <div><span className="eyebrow">World Module 10</span><h2>World Settings</h2></div>
      <small>PRIVACY · DISCOVERY · SHARING</small>
    </header>

    <section className="forge-form-section">
      <h4>Privacy</h4>
      <label className="forge-field">
        <span>World visibility</span>
        <select value={visibility} onChange={(event) => update('visibility', event.target.value)}>
          <option value="private">Private · owner only</option>
          <option value="unlisted">Unlisted · direct access only</option>
          <option value="public">Public</option>
        </select>
        <small>Private worlds and all world-linked records are hidden from other users at the server API level.</small>
      </label>
      <div className="forge-toggle-row">
        <label className="forge-toggle">
          <input type="checkbox" checked={showInLibrary} disabled={visibility !== 'public'} onChange={(event) => update('showInLibrary', event.target.checked)} />
          <span>Show this world and its linked records in Orbis browse and search</span>
        </label>
      </div>
      {visibility === 'private' && <div className="forge-inheritance"><span className="forge-lamp" /><div><strong>Owner-only world</strong><p>Only the world owner can discover, open, edit, or launch this world and its child records. Super-admin access remains available for recovery and administration.</p></div></div>}
      {visibility === 'unlisted' && <div className="forge-inheritance"><span className="forge-lamp" /><div><strong>Unlisted world</strong><p>The world stays out of public shelves and search, but someone with a direct record link can open it.</p></div></div>}
    </section>

    <section className="forge-form-section">
      <h4>Sharing</h4>
      <div className="forge-toggle-row">
        <label className="forge-toggle">
          <input type="checkbox" checked={allowForking} onChange={(event) => update('allowForking', event.target.checked)} />
          <span>Allow other users to fork/copy this world when they have access</span>
        </label>
      </div>
      <div className="forge-inheritance"><span className="forge-lamp" /><div><strong>World settings are inherited</strong><p>Places, species, factions, societies, families, memories, and other records linked to this world inherit the world's privacy. A child record cannot accidentally leak a private world through Orbis browse, search, direct lookup, or Speculus launch.</p></div></div>
    </section>
  </section>;
}
