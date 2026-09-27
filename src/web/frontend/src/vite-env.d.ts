/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SEMANTIC_SCHOLAR_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
