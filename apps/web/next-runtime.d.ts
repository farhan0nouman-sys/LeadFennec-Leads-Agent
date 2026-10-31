declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * Set by Next.js to the runtime executing the code. Read it as `process.env.NEXT_RUNTIME`
     * (dot access): Next.js replaces that exact expression at build time.
     */
    readonly NEXT_RUNTIME?: 'nodejs' | 'edge';
  }
}
