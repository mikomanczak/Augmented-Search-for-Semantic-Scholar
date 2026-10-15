import { useEffect, useState } from 'react';
import SearchProgressModal from './SearchProgressModal';
import InputForm from './InputForm';
import mockPapers from '../context/mock-results.json';
import './SearchProgressPreview.css';

const SAMPLE_QUERIES = ['battery electric vehicle', 'BEV', 'electric cars', 'EV battery'];

export default function SearchProgressPreview() {
  const [modalOpen, setModalOpen] = useState(true);
  const [completed, setCompleted] = useState(7);
  const [playing, setPlaying] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(5);
  const [resting, setResting] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCompleted(value => Math.min(20, value + 1));
    }, 600);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (completed === 20) setPlaying(false);
  }, [completed]);

  return (
    <>
      <button className="secondary-button progress-preview-link" type="button" onClick={() => setModalOpen(true)}>Open progress preview</button>
      <InputForm onSearch={() => setModalOpen(true)} isSearching={false} />
      {modalOpen && <SearchProgressModal
        papers={completed > 0 ? mockPapers.slice(0, completed * 2) : []}
        progress={{ completed, total: 20, currentQuery: completed < 20 ? SAMPLE_QUERIES[completed % SAMPLE_QUERIES.length] : null }}
        retryProgress={resting ? { reason: 'network', attempt: retryAttempt, maxRetries: 60, retryAt: 0 } : null}
        onDismiss={() => { setPlaying(false); setModalOpen(false); }}>

      <div className="search-progress-preview__controls">
        <h1 id="preview-title">Search progress preview</h1>
        <p>Local simulation · No Semantic Scholar requests</p>
        <label htmlFor="preview-progress">Fetched queries: {completed} of 20</label>
        <input id="preview-progress" type="range" min="0" max="20" value={completed}
          onChange={event => { setPlaying(false); setCompleted(Number(event.target.value)); }} />
        <div className="search-progress-preview__actions">
          <button className="secondary-button" type="button" onClick={() => {
            if (!playing && completed === 20) setCompleted(0);
            setPlaying(value => !value);
          }}>{playing ? 'Pause progress' : 'Play progress'}</button>
          <button className="secondary-button" type="button" onClick={() => { setPlaying(false); setCompleted(0); }}>Reset</button>
          <label><input type="checkbox" checked={resting} onChange={event => setResting(event.target.checked)} /> Resting animation</label>
          <button className="secondary-button" type="button" onClick={() => { setPlaying(false); setModalOpen(false); }}>Close preview</button>
          <a href="?mock_results">Back to mock search</a>
        </div>
        {resting && <label htmlFor="preview-retries">Retry attempt: {retryAttempt}
          <input id="preview-retries" type="range" min="1" max="60" value={retryAttempt}
            onChange={event => setRetryAttempt(Number(event.target.value))} />
        </label>}
      </div>
      </SearchProgressModal>}
    </>
  );
}
