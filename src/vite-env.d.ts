/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORBIS_API_URL?: string;
  readonly VITE_HW_LIBRARY_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
