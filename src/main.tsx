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
import './styles/i18n.css';
import './styles/project-etas.css';
import './styles/project-pages.css';
import './styles/sidebar-scroll.css';
import './styles/world-forge.css';
import './styles/theme.css';
import './styles/record-detail.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider><AuthProvider><App /></AuthProvider></I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
