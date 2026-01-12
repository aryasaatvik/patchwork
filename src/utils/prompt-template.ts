/**
 * Simple mustache-style template rendering for prompts.
 * Uses {{variableName}} syntax for variable substitution.
 */
export function renderPrompt<T extends Record<string, string | number>>(
  template: string,
  context: T
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) => {
      const value = context[key as keyof T]
      return value !== undefined ? String(value) : match
    }
  )
}
