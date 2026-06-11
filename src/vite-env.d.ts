/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_POWERSYNC_URL: string;
  // Dev-only — present only in `npm run dev`, undefined in production builds.
  readonly VITE_DEV_LOGIN_EMAIL?: string;
  readonly VITE_DEV_LOGIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
