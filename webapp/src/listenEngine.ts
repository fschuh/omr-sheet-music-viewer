declare const __LISTEN_ENGINE__: { label: string; detail: string };

/**
 * Build-time identity of the installed engine package: its version and the
 * revision this build's dependency pins. Injected by vite.config.ts.
 */
export const LISTEN_ENGINE = __LISTEN_ENGINE__;
