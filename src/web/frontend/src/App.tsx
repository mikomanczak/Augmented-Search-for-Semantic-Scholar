import { useEffect, useState } from 'react';
import Export from './components/Export';
import InputForm from './components/InputForm';
import Results from './components/Results';
import SearchProgressModal from './components/SearchProgressModal';
import SearchErrorNotice from './components/SearchErrorNotice';
import SearchProgressPreview from './components/SearchProgressPreview';
import { SearchProvider } from './context/SearchContext';
import { View } from './types';
import { useSearch } from './context/SearchContext';
import './App.css';

function AppContent() {
  const [view, setView] = useState<View>('input');
  const [lightMode, setLightMode] = useState(() => {
    try {
      return window.localStorage.getItem('theme') === 'light';
    } catch {
      return false;
    }
  });
  const { search, cancelSearch, isSearching, hasSuccessfulSearch, searchProgress, retryProgress, fetchedPapers } = useSearch();
  const isLocalDevelopment = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  const params = new URLSearchParams(window.location.search);
  const isProgressPreview = isLocalDevelopment && params.has('mock_progress');

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
      {isProgressPreview ? <SearchProgressPreview /> : <>
        {isLocalDevelopment && params.has('mock_results') && <a className="progress-preview-link" href="?mock_progress">Preview search progress</a>}
        {view === 'input' && <>
          <InputForm onSearch={() => void search()} isSearching={isSearching} />
          <SearchErrorNotice />
        </>}
        {isSearching && searchProgress && <SearchProgressModal progress={searchProgress} retryProgress={retryProgress} papers={fetchedPapers} onDismiss={cancelSearch} />}
        {view === 'results' && hasSuccessfulSearch && !isSearching && <Results />}
        {view === 'export' && <Export />}
      </>}
    </main>
  );
}

export default function App() {
  return <SearchProvider><AppContent /></SearchProvider>;
}
