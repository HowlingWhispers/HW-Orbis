import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import { App } from './app/App';
import { AuthProvider } from './auth/AuthContext';
import { I18nProvider } from './i18n/I18nContext';
import { ThemeProvider } from './theme/ThemeContext';
import './styles/global.css';
import './styles/asset-images.css';
import './styles/i18n.css';
import './styles/project-etas.css';
import './styles/project-pages.css';
import './styles/sidebar-scroll.css';
import './styles/world-forge.css';
import './styles/world-create.css';
import './styles/record-detail.css';
import './styles/world-portal.css';
import './styles/collection-actions.css';
import './styles/destructive.css';
import './styles/coda-assistant.css';
import './styles/coda-file-editor.css';
import './styles/coda-workspace.css';
import './styles/coda-admin.css';
import './styles/changelog.css';
// Last on purpose. This file carries the light-mode overrides, and the sheets
// above contain rules such as `.coda-assistant textarea` that tie with the
// generic `:root[data-theme='light'] textarea` rule on specificity. Equal
// specificity is settled by order, so loading the overrides before those sheets
// silently left dark inputs standing in light mode.
import './styles/theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider><AuthProvider><App /></AuthProvider></I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
