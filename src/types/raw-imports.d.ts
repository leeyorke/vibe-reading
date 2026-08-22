/**
 * Ambient type declarations for Vite's `?raw` static asset imports.
 * Lets us import prompt templates (e.g. selection-translate-prompt.md)
 * as plain strings.
 */
declare module "*?raw" {
  const content: string
  export default content
}
