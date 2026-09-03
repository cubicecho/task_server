import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A labelled control, with an optional note under it.
 *
 * Label, control, note is what both forms in this app are almost entirely made of, and written
 * out by hand it was the same four lines twenty-odd times — so the spacing, and the way a label
 * is tied to its control, was twenty edits rather than one.
 *
 * `htmlFor` is its own prop rather than being derived from `label` because a label is not always
 * a string, and because a `Field` around a Radix trigger has to point at an id that trigger owns
 * rather than at an input of its own.
 */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * A `Field` whose control is a number, and which hands back one.
 *
 * The conversion lives here because it is the thing every caller used to repeat and the thing
 * one of them could forget: an `onChange` that passes `event.target.value` straight through
 * stores the string `"4"` where the rest of the form has numbers, and nothing says so until the
 * server rejects it.
 */
export function NumberField({
  id,
  label,
  hint,
  value,
  step,
  onChange,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: number;
  step?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}
