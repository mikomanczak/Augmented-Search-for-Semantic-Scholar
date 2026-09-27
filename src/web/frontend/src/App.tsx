import { useState } from 'react';
import Export from './components/Export';
import InputForm from './components/InputForm';
import Results from './components/Results';
import { SearchProvider } from './context/SearchContext';
import { View } from './types';
import { useSearch } from './context/SearchContext';
import './App.css';

function AppContent() {
  const [view, setView] = useState<View>('input');
  const { search, isSearching } = useSearch();

  return (
    <main className="app-shell">
      {view === 'input' && <InputForm onSearch={async () => { setView('results'); await search(); }} isSearching={isSearching} />}
      {view === 'results' && <Results onBack={() => setView('input')} />}
      {view === 'export' && <Export />}
    </main>
  );
}

export default function App() {
  return <SearchProvider><AppContent /></SearchProvider>;
}
