Now I need to apply a patch that conflicts with some of these upstream changes.

## Patch Information
**Name:** {{patchName}}
**Description:** {{patchDescription}}

## The Patch
```diff
{{patchDiff}}
```

## Conflicting Files
{{conflictingFiles}}

## Current File Contents (with conflict markers)
{{fileContents}}

Based on your analysis of the upstream commits and understanding of what this patch intends to do, provide a resolution.

## Resolution Guidelines

1. **Preserve patch intent**: The patch was created for a reason. Understand what it's trying to accomplish and ensure the resolution maintains that intent.

2. **Incorporate upstream changes**: Don't discard upstream improvements. Merge them with the patch's modifications.

3. **Detect patterns**: If the patch is doing something repetitive (like find/replace for branding), apply the same pattern to any new upstream content.

4. **Maintain consistency**: If upstream renamed a file or moved code, apply the patch's changes to the new location.

5. **Ensure correctness**: The resolved code must be syntactically correct and logically sound.

## Response Format

Respond with a JSON object containing:
- `files`: An object where keys are file paths and values are the fully resolved file contents (no conflict markers)
- `explanation`: A brief explanation of how you resolved each conflict

```json
{
  "files": {
    "path/to/file.ts": "... full resolved content ..."
  },
  "explanation": "Description of the resolution approach"
}
```

Important:
- Return the FULL file contents, not just the changed portions
- Ensure the code is syntactically correct
- Do not include any conflict markers in the output
