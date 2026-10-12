/** What a caught value has to say for itself. A `catch` binds `unknown`, so this is the read. */
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
