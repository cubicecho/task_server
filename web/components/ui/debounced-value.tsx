import { useEffect, useState } from "react";

/**
 * `value`, once it has held still for `delayMs`: each change restarts the wait, and the first
 * render has the value at once. A component that holds both reads `value` for what it draws and
 * this for what it asks a server.
 *
 * @param value - The value as it is now, such as the text in a field.
 * @param delayMs - How long the value has to hold still, in milliseconds. 250 waits out a word.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
