/**
 * A text field that may not be left blank, with the sentence to put under it when it is.
 *
 * The message is the caller's because "required" says nothing a red box does not: what the
 * thing is for is the useful half ("A task needs a name.").
 */
export const required = (message: string) => ({
  onChange: ({ value }: { value: string }) => (value.trim() ? undefined : message),
});
