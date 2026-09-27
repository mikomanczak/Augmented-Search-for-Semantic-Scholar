import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

const MAX_KEYWORDS = 20;
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

export type Paper = {
  paperId: string;
  title: string;
  abstract?: string | null;
  year?: number | null;
  authors?: { authorId?: string | null; name: string }[];
  venue?: string | null;
  citationCount?: number | null;
  url?: string;
  openAccessPdf?: { url: string } | null;
};

type PersistedState = {
  keywordText: string;
  resultsPerKeyword: string;
  startYear: string;
  endYear: string;
  openAccessOnly: boolean;
  minCitations: string;
  publicationTypes: PublicationType[];
};

const DEFAULT_STATE: PersistedState = {
  keywordText: EXAMPLE_KEYWORDS.join('\n'),
  resultsPerKeyword: '50',
  startYear: '2010',
  endYear: '2024',
  openAccessOnly: false,
  minCitations: '',
  publicationTypes: [],
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
    return {
      keywordText: typeof parsed.keywordText === 'string' ? parsed.keywordText : DEFAULT_STATE.keywordText,
      resultsPerKeyword:
        typeof parsed.resultsPerKeyword === 'string' ? parsed.resultsPerKeyword : DEFAULT_STATE.resultsPerKeyword,
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
  resultsPerKeyword: string;
  setResultsPerKeyword: (value: string) => void;
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
  maxKeywords: number;
  results: Paper[];
  isSearching: boolean;
  searchError: string | null;
  rateLimited: boolean;
  search: () => Promise<void>;
};

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(loadPersistedState, []);
  const [keywordText, setKeywordTextRaw] = useState(initial.keywordText);
  const [resultsPerKeyword, setResultsPerKeyword] = useState(initial.resultsPerKeyword);
  const [startYear, setStartYear] = useState(initial.startYear);
  const [endYear, setEndYear] = useState(initial.endYear);
  const [openAccessOnly, setOpenAccessOnly] = useState(initial.openAccessOnly);
  const [minCitations, setMinCitationsRaw] = useState(initial.minCitations);
  const [publicationTypes, setPublicationTypes] = useState<PublicationType[]>(initial.publicationTypes);
  const [results, setResults] = useState<Paper[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  const search = async () => {
    const combinedQuery = keywords.map(keyword => `(${keyword})`).join(' | ');
    if (!combinedQuery) return;

    setIsSearching(true);
    setSearchError(null);
    setRateLimited(false);
    setResults([]);
    try {
      const params = new URLSearchParams({
        query: combinedQuery,
        limit: String(Math.min(100, Math.max(1, Number(resultsPerKeyword) || 50))),
        fields: 'paperId,title,abstract,year,authors,venue,citationCount,url,openAccessPdf',
      });
      if (startYear && endYear) params.set('publicationDateOrYear', `${startYear}:${endYear}`);
      else if (startYear) params.set('publicationDateOrYear', `${startYear}:`);
      else if (endYear) params.set('publicationDateOrYear', `:${endYear}`);
      if (minCitations) params.set('minCitationCount', minCitations);
      if (publicationTypes.length) params.set('publicationTypes', publicationTypes.join(','));
      if (openAccessOnly) params.set('openAccessPdf', 'true');

      const apiKey = import.meta.env.VITE_SEMANTIC_SCHOLAR_API_KEY;
      const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      });
      if (!response.ok) {
        if (response.status === 429) setRateLimited(true);
        const detail = response.status === 429
          ? 'Semantic Scholar rate limit reached.'
          : `Semantic Scholar search failed (${response.status}). Please try again.`;
        throw new Error(detail);
      }
      const payload = await response.json() as { data?: Paper[] };
      setResults(payload.data ?? []);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload: PersistedState = {
        keywordText,
        resultsPerKeyword,
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
  }, [keywordText, resultsPerKeyword, startYear, endYear, openAccessOnly, minCitations, publicationTypes]);

  const setMinCitations = (value: string) => {
    if (value === '') {
      setMinCitationsRaw('');
      return;
    }
    const digits = value.replace(/[^0-9]/g, '');
    setMinCitationsRaw(digits);
  };

  const togglePublicationType = (value: PublicationType) => {
    setPublicationTypes(prev =>
      prev.includes(value) ? prev.filter(entry => entry !== value) : [...prev, value],
    );
  };

  const setKeywordText = (value: string) => {
    const lines = value.split(/\r?\n/);
    setKeywordTextRaw(lines.slice(0, MAX_KEYWORDS).join('\n'));
  };

  const { keywords, keywordCount } = useMemo(() => {
    const parsed = keywordText
      .split(/\r?\n/)
      .map(keyword => keyword.trim())
      .filter(Boolean);
    return {
      keywords: parsed,
      keywordCount: Math.min(parsed.length, MAX_KEYWORDS),
    };
  }, [keywordText]);

  const value: SearchContextValue = {
    keywordText,
    setKeywordText,
    keywords,
    keywordCount,
    resultsPerKeyword,
    setResultsPerKeyword,
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
    maxKeywords: MAX_KEYWORDS,
    results,
    isSearching,
    searchError,
    rateLimited,
    search,
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
