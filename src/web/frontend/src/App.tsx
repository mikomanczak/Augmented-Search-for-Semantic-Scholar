import { useEffect, useState } from 'react';
import Export from './components/Export';
import InputForm from './components/InputForm';
import Results from './components/Results';
import SearchProgressModal from './components/SearchProgressModal';
import { SearchProvider } from './context/SearchContext';
import { View } from './types';
import { useSearch } from './context/SearchContext';
import './App.css';

function AppContent() {
  const [view, setView] = useState<View>('input');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [lightMode, setLightMode] = useState(() => {
    try {
      return window.localStorage.getItem('theme') === 'light';
    } catch {
      return false;
    }
  });
  const { search, cancelSearch, isSearching, hasSuccessfulSearch, searchProgress, searchError, retryProgress, fetchedPapers } = useSearch();

  useEffect(() => {
    if (isSearching) setView('input');
    else if (hasSuccessfulSearch) setView('results');
  }, [isSearching, hasSuccessfulSearch]);

  useEffect(() => {
    document.documentElement.dataset.theme = lightMode ? 'light' : 'dark';
    try {
      window.localStorage.setItem('theme', lightMode ? 'light' : 'dark');
    } catch {
      // The theme still works for this session when storage is unavailable.
    }
  }, [lightMode]);

  return (
    <>
    <main className="mobile-notice" aria-labelledby="mobile-notice-title">
      <header className="mobile-notice__header">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="32" height="32" alt="" />
        <span>Augmented <strong>Search</strong><small>For Semantic Scholar</small></span>
      </header>
      <section className="mobile-notice__content">
        <div className="mobile-notice__queries" aria-label="Example research queries">
          <div className="mobile-notice__queries-label">Queries</div>
          <ol>
            <li><code>transformer<span className="mobile-notice__operator">+</span>attention</code></li>
            <li><code className="mobile-notice__phrase">"contrastive learning"</code></li>
            <li><code>reinforcement learning <span className="mobile-notice__operator">-</span>survey</code></li>
            <li className="mobile-notice__query-extra"><code>graph neural networks</code></li>
            <li className="mobile-notice__query-extra"><code className="mobile-notice__phrase">"self-supervised learning"</code></li>
            <li className="mobile-notice__query-extra"><code>vision transformer <span className="mobile-notice__operator">-</span>review</code></li>
            <li className="mobile-notice__query-tall"><code>diffusion<span className="mobile-notice__operator">+</span>generation</code></li>
            <li className="mobile-notice__query-tall"><code className="mobile-notice__phrase">"Bayesian inference"</code></li>
            <li className="mobile-notice__query-tall"><code>model<span className="mobile-notice__operator">+</span>calibration</code></li>
          </ol>
        </div>
        <h1 id="mobile-notice-title">Advanced search needs more space</h1>
        <p className="mobile-notice__description">Augmented Search is a relatively complex tool for Semantic Scholar power users. Its query editor and advanced search controls require a larger screen than your mobile device can offer. Please open this page on your computer.</p>
        <button className="mobile-notice__copy" type="button" aria-live="polite" onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setCopyStatus('copied');
          } catch {
            setCopyStatus('error');
          }
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></svg>
          {copyStatus === 'copied' ? 'Link copied' : 'Copy page link'}
        </button>
        {copyStatus === 'error' && <p className="mobile-notice__status" role="alert">Copy the page address from your browser instead.</p>}
      </section>
    </main>
    <main className="app-shell">
      <header className="app-header">
        {view === 'results' ? (
          <a className="results-back" href="#search" onClick={event => { event.preventDefault(); setView('input'); }}>
            <span aria-hidden="true">←</span> Edit search
          </a>
        ) : (
          <a className="brand" href="#search" onClick={event => { event.preventDefault(); setView('input'); }} aria-label="Augmented Search home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5c3-1 5.5-.5 8 1.5 2.5-2 5-2.5 8-1.5v13c-3-1-5.5-.5-8 1.5-2.5-2-5-2.5-8-1.5zM12 7v13" /></svg>
            </span>
            <span>Augmented <strong>Search</strong><small>For Semantic Scholar</small></span>
          </a>
        )}
        <div className="app-header__actions">
          <a className="source-link" href="https://github.com/mikomanczak/Augmented-Search-for-Semantic-Scholar" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${lightMode ? 'dark' : 'light'} mode`}
            aria-pressed={lightMode}
            onClick={() => setLightMode(value => !value)}
          >
            <span aria-hidden="true">{lightMode ? '☾' : '☀'}</span>
            {lightMode ? 'Dark mode' : 'Light mode'}
          </button>
        </div>
      </header>
      {view === 'input' && <>
        <InputForm onSearch={() => void search()} isSearching={isSearching} />
      </>}
      {(isSearching || searchError) && searchProgress && <SearchProgressModal progress={searchProgress} searchError={searchError} retryProgress={retryProgress} papers={fetchedPapers} onDismiss={cancelSearch} />}
      {view === 'results' && hasSuccessfulSearch && !isSearching && <Results />}
      {view === 'export' && <Export />}
    </main>
    </>
  );
}

export default function App() {
  return <SearchProvider><AppContent /></SearchProvider>;
}
