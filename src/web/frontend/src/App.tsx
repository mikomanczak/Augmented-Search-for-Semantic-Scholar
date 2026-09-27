import { useEffect, useState } from 'react';
import Export from './components/Export';
import InputForm from './components/InputForm';
import Results from './components/Results';
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
  const { search, isSearching } = useSearch();

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
      {view === 'input' && <InputForm onSearch={async () => { setView('results'); await search(); }} isSearching={isSearching} />}
      {view === 'results' && <Results onBack={() => setView('input')} />}
      {view === 'export' && <Export />}
    </main>
  );
}

export default function App() {
  return <SearchProvider><AppContent /></SearchProvider>;
}
