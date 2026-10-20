import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import mockResults from './mock-results.json';
import mockBrowserResults from './mock-results2 copy.json';
import mockTypescriptResults from './mock-results3.json';
import type { QueryResult } from '../lib/query-overlap';
import type { RetryProgress } from '../../../../shared/retry.ts';
import { searchQueries, SearchQueryCache, SearchError, type SearchProgress, type FetchedPaper } from '../lib/search-queries';

const STORAGE_KEY = 'augmented-search:state:v1';

const EXAMPLE_KEYWORDS = [
  'battery electric vehicle',
  'BEV',
  'electric cars',
  'EV battery',
  'lithium ion battery',
  'battery technology',
  'range anxiety',
];

const MOCK_QUERY_RESULTS: QueryResult[] = [
  { query: 'JavaScript', papers: mockResults },
  { query: 'Browser', papers: mockBrowserResults.data },
  { query: 'TypeScript', papers: mockTypescriptResults.data },
];

function isLocalMockMode(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  return isLocalhost && new URLSearchParams(window.location.search).has('mock_results');
}

export const PUBLICATION_TYPES = [
  'Review',
  'JournalArticle',
  'CaseReport',
  'ClinicalTrial',
  'Conference',
  'Dataset',
  'Editorial',
  'LettersAndComments',
  'MetaAnalysis',
  'News',
  'Study',
  'Book',
  'BookSection',
] as const;

export type PublicationType = (typeof PUBLICATION_TYPES)[number];

// Semantic Scholar Academic Graph API: https://api.semanticscholar.org/graph/v1/swagger.json
export const FIELDS_OF_STUDY = [
  'Agricultural and Food Sciences',
  'Art',
  'Biology',
  'Business',
  'Chemistry',
  'Computer Science',
  'Economics',
  'Education',
  'Engineering',
  'Environmental Science',
  'Geography',
  'Geology',
  'History',
  'Law',
  'Linguistics',
  'Materials Science',
  'Mathematics',
  'Medicine',
  'Philosophy',
  'Physics',
  'Political Science',
  'Psychology',
  'Sociology',
] as const;

export type FieldOfStudy = (typeof FIELDS_OF_STUDY)[number];

export type Paper = {
  paperId: string;
  title: string;
  abstract?: string | null;
  embedding?: { model: string; vector: number[] } | null;
  year?: number | null;
  authors?: { authorId?: string | null; name: string }[];
  venue?: string | null;
  publicationTypes?: string[] | null;
  citationCount?: number | null;
  url?: string;
  openAccessPdf?: { url: string } | null;
  externalIds?: { DOI?: string | null; ArXiv?: string | null; PubMedCentral?: string | null } | null;
};

type PersistedState = {
  keywordText: string;
  fieldsOfStudy: FieldOfStudy[];
  startYear: string;
  endYear: string;
  openAccessOnly: boolean;
  minCitations: string;
  publicationTypes: PublicationType[];
};

const DEFAULT_STATE: PersistedState = {
  keywordText: EXAMPLE_KEYWORDS.join('\n'),
  fieldsOfStudy: [],
  startYear: '2010',
  endYear: '2024',
  openAccessOnly: false,
  minCitations: '',
  publicationTypes: [...PUBLICATION_TYPES],
};

function loadPersistedState(): PersistedState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const validTypes = new Set<string>(PUBLICATION_TYPES);
    const publicationTypes = Array.isArray(parsed.publicationTypes)
      ? (parsed.publicationTypes.filter(
          (value): value is PublicationType => typeof value === 'string' && validTypes.has(value),
        ))
      : DEFAULT_STATE.publicationTypes;
    const validFields = new Set<string>(FIELDS_OF_STUDY);
    const fieldsOfStudy = Array.isArray(parsed.fieldsOfStudy)
      ? [...new Set(parsed.fieldsOfStudy.filter(
          (value): value is FieldOfStudy => typeof value === 'string' && validFields.has(value),
        ))]
      : DEFAULT_STATE.fieldsOfStudy;
    return {
      keywordText: typeof parsed.keywordText === 'string' ? parsed.keywordText : DEFAULT_STATE.keywordText,
      fieldsOfStudy,
      startYear: typeof parsed.startYear === 'string' ? parsed.startYear : DEFAULT_STATE.startYear,
      endYear: typeof parsed.endYear === 'string' ? parsed.endYear : DEFAULT_STATE.endYear,
      openAccessOnly:
        typeof parsed.openAccessOnly === 'boolean' ? parsed.openAccessOnly : DEFAULT_STATE.openAccessOnly,
      minCitations: typeof parsed.minCitations === 'string' ? parsed.minCitations : DEFAULT_STATE.minCitations,
      publicationTypes,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

type SearchContextValue = {
  keywordText: string;
  setKeywordText: (value: string) => void;
  keywords: string[];
  keywordCount: number;
  fieldsOfStudy: FieldOfStudy[];
  toggleFieldOfStudy: (value: FieldOfStudy) => void;
  clearFieldsOfStudy: () => void;
  startYear: string;
  setStartYear: (value: string) => void;
  endYear: string;
  setEndYear: (value: string) => void;
  openAccessOnly: boolean;
  setOpenAccessOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  minCitations: string;
  setMinCitations: (value: string) => void;
  publicationTypes: PublicationType[];
  setPublicationTypes: (value: PublicationType[] | ((prev: PublicationType[]) => PublicationType[])) => void;
  togglePublicationType: (value: PublicationType) => void;
  results: Paper[];
  queryResults: QueryResult[];
  hasSuccessfulSearch: boolean;
  isSearching: boolean;
  retryProgress: RetryProgress | null;
  searchProgress: SearchProgress | null;
  fetchedPapers: FetchedPaper[];
  searchError: string | null;
  rateLimited: boolean;
  isMockResultsEnabled: boolean;
  search: () => Promise<void>;
  cancelSearch: () => void;
};

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(loadPersistedState, []);
  const [keywordText, setKeywordTextRaw] = useState(isLocalMockMode() ? MOCK_QUERY_RESULTS.map(result => result.query).join('\n') : initial.keywordText);
  const [fieldsOfStudy, setFieldsOfStudy] = useState<FieldOfStudy[]>(initial.fieldsOfStudy);
  const [startYear, setStartYear] = useState(initial.startYear);
  const [endYear, setEndYear] = useState(initial.endYear);
  const [openAccessOnly, setOpenAccessOnly] = useState(initial.openAccessOnly);
  const [minCitations, setMinCitationsRaw] = useState(initial.minCitations);
  const [publicationTypes, setPublicationTypes] = useState<PublicationType[]>(initial.publicationTypes);
  const [results, setResults] = useState<Paper[]>([]);
  const [fetchedPapers, setFetchedPapers] = useState<FetchedPaper[]>([]);
  const [queryResults, setQueryResults] = useState<QueryResult[]>([]);
  const [hasSuccessfulSearch, setHasSuccessfulSearch] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  const [retryProgress, setRetryProgress] = useState<RetryProgress | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const isMockResultsEnabled = isLocalMockMode();
  const [queryCache] = useState(() => new SearchQueryCache());
  const searchControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => searchControllerRef.current?.abort(), []);

  const cancelSearch = () => {
    searchControllerRef.current?.abort();
    searchControllerRef.current = null;
    setIsSearching(false);
    setRetryProgress(null);
    setSearchProgress(null);
    setFetchedPapers([]);
    setSearchError(null);
    setHasSuccessfulSearch(false);
  };

  const search = async () => {
    if (!keywords.length || isSearching || searchControllerRef.current) return;
    const controller = new AbortController();
    searchControllerRef.current = controller;

    setIsSearching(true);
    setSearchProgress({ completed: 0, total: keywords.length, currentQuery: keywords[0] });
    setRetryProgress(null);
    setSearchError(null);
    setRateLimited(false);
    setResults([]);
    setFetchedPapers([]);
    setQueryResults([]);
    setHasSuccessfulSearch(false);
    try {
      if (isMockResultsEnabled) {
        const mockQueries = MOCK_QUERY_RESULTS.map(result => ({
          ...result,
          papers: result.papers.filter(paper =>
            (!startYear || (paper.year != null && paper.year >= Number(startYear))) &&
            (!endYear || (paper.year != null && paper.year <= Number(endYear))) &&
            (!minCitations || (paper.citationCount != null && paper.citationCount >= Number(minCitations))) &&
            (!openAccessOnly || Boolean(paper.openAccessPdf?.url)),
          ),
        }));
        setQueryResults(mockQueries);
        setResults([...new Map(mockQueries.flatMap(result => result.papers).map(paper => [paper.paperId, paper])).values()]);
        setHasSuccessfulSearch(true);
        return;
      }

      const params = new URLSearchParams({
        limit: '50',
        fields: 'paperId,title,abstract,year,authors,venue,publicationTypes,citationCount,url,openAccessPdf,externalIds',
      });
      if (startYear && endYear) params.set('publicationDateOrYear', `${startYear}:${endYear}`);
      else if (startYear) params.set('publicationDateOrYear', `${startYear}:`);
      else if (endYear) params.set('publicationDateOrYear', `:${endYear}`);
      if (fieldsOfStudy.length) params.set('fieldsOfStudy', fieldsOfStudy.join(','));
      if (minCitations) params.set('minCitationCount', minCitations);
      if (publicationTypes.length) params.set('publicationTypes', publicationTypes.join(','));
      if (openAccessOnly) params.set('openAccessPdf', 'true');

      const apiKey = import.meta.env.VITE_SEMANTIC_SCHOLAR_API_KEY;
      const completed = await searchQueries(keywords, params, apiKey, setRetryProgress, setSearchProgress, setFetchedPapers, controller.signal, queryCache);
      if (controller.signal.aborted) return;
      setQueryResults(completed.queryResults);
      setResults(completed.results);
      setHasSuccessfulSearch(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SearchError && error.status === 429) setRateLimited(true);
      setSearchError(error instanceof Error ? error.message : 'Search failed. Please try again.');
    } finally {
      if (searchControllerRef.current === controller) {
        searchControllerRef.current = null;
        setRetryProgress(null);
        setIsSearching(false);
      }
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload: PersistedState = {
        keywordText,
        fieldsOfStudy,
        startYear,
        endYear,
        openAccessOnly,
        minCitations,
        publicationTypes,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota / access errors
    }
  }, [keywordText, fieldsOfStudy, startYear, endYear, openAccessOnly, minCitations, publicationTypes]);

  const setMinCitations = (value: string) => {
    if (value === '') {
      setMinCitationsRaw('');
      return;
    }
    const digits = value.replace(/[^0-9]/g, '');
    setMinCitationsRaw(digits);
  };

  const toggleFieldOfStudy = (value: FieldOfStudy) => {
    setFieldsOfStudy(prev =>
      prev.includes(value) ? prev.filter(entry => entry !== value) : [...prev, value],
    );
  };

  const clearFieldsOfStudy = () => setFieldsOfStudy([]);

  const togglePublicationType = (value: PublicationType) => {
    setPublicationTypes(prev =>
      prev.includes(value) ? prev.filter(entry => entry !== value) : [...prev, value],
    );
  };

  const setKeywordText = (value: string) => {
    setKeywordTextRaw(value);
  };

  const { keywords, keywordCount } = useMemo(() => {
    const parsed = keywordText
      .split(/\r?\n/)
      .map(keyword => keyword.trim())
      .filter(Boolean);
    return {
      keywords: parsed,
      keywordCount: parsed.length,
    };
  }, [keywordText]);

  const value: SearchContextValue = {
    keywordText,
    setKeywordText,
    keywords,
    keywordCount,
    fieldsOfStudy,
    toggleFieldOfStudy,
    clearFieldsOfStudy,
    startYear,
    setStartYear,
    endYear,
    setEndYear,
    openAccessOnly,
    setOpenAccessOnly,
    minCitations,
    setMinCitations,
    publicationTypes,
    setPublicationTypes,
    togglePublicationType,
    results,
    queryResults,
    hasSuccessfulSearch,
    isSearching,
    retryProgress,
    searchProgress,
    fetchedPapers,
    searchError,
    rateLimited,
    isMockResultsEnabled,
    search,
    cancelSearch,
  };

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return ctx;
}
