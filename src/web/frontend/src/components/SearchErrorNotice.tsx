import { useSearch } from '../context/SearchContext';

export default function SearchErrorNotice() {
  const { searchError, rateLimited, isSearching, search } = useSearch();
  const isRateLimitError = rateLimited || /rate.?limit|too many requests|quota exceeded|\b429\b/i.test(searchError ?? '');
  const isFetchFailure = /failed to fetch|networkerror|network request failed/i.test(searchError ?? '');
  return <>
      {searchError && (isRateLimitError || isFetchFailure ? (
        <section className="results-error rate-limit-notice" role="alert">
          <img className="rate-limit-art" src={`${import.meta.env.BASE_URL}rate-limit-robot.png`} alt="A friendly vintage robot" />
          <div>
            <h2>{isRateLimitError ? 'That was a lot of searching at once' : 'The search service didn’t respond'}</h2>
            <p>{isRateLimitError
              ? `${searchError} This demo uses shared public API access, which is rate limited. Please wait a little and rerun your search.`
              : `${searchError}. The browser couldn’t read a response from Semantic Scholar, so we can’t confirm the cause. Shared public API access may be temporarily unavailable or rate limited. Please wait a little and rerun your search.`}</p>
            <p>You can also self-host the app and provide your own Semantic Scholar API key for your searches.</p>
            <div className="rate-limit-actions">
              <button className="primary-button" type="button" onClick={() => void search()} disabled={isSearching}>
                {isSearching ? 'Searching…' : 'Retry search'}
              </button>
              <a
                className="secondary-button api-key-docs-button"
                href="https://github.com/mikomanczak/Augmented-Search-for-Semantic-Scholar#web"
                target="_blank"
                rel="noreferrer"
              >
                Run with your own API key
              </a>
            </div>
          </div>
        </section>
      ) : <p className="results-error" role="alert">{searchError}</p>)}
  </>;
}
