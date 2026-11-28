/**
 * A status as a `Badge`, looked up in the app's map of statuses: what each one is called, the
 * badge's colour, and optionally an icon, so the colour is not the only thing that says it. The
 * map is the app's because the statuses are its domain's words; this only looks them up.
 *
 * A status the map does not know is drawn as it came, in `outline`, rather than throwing or
 * drawing nothing: the server can be newer than the bundle, and a word it has never heard of is
 * still the truest thing to show.
 */
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import type { SlotNode } from "@/lib/utils";

/** How one status is drawn: an entry of the app's map. */
export type StatusLook = {
  /** What the status is called, in the reader's words: "Doesn't compile" for `FAILED`. */
  label: string;
  /**
   * The badge's colour: `positive`, `warning`, `destructive` or `info` for a verdict, each `-soft`
   * beside a row's words, `outline` or `secondary` for a state that is not one.
   */
  variant: BadgeVariant;
  /** Before the label: an icon, so a status reads apart from its neighbours without its colour. */
  iconSlot?: SlotNode;
};

/** What a status the map does not know is drawn as: its own text, quiet. */
const UNKNOWN_VARIANT = "outline";

type StatusBadgeProps<Status extends string> = {
  /**
   * The status as it came. Its type offers the map's keys, and takes any string as well, so a
   * status from a newer server, or one typed as a plain `string`, still compiles and is drawn as
   * its own text.
   */
  status: NoInfer<Status> | (string & Record<never, never>);
  /**
   * The app's map from each status to its label, colour and icon. Keyed by the status type
   * (`satisfies Record<HostStatus, StatusLook>`), so a status added to the schema is a type error
   * until it has a look.
   */
  statuses: Readonly<Record<Status, StatusLook>>;
  /** On the badge. */
  className?: string | undefined;
};

/** The look the map holds for `status`, if it holds one of its own and not one off the prototype. */
function lookUp(
  statuses: Readonly<Record<string, StatusLook>>,
  status: string,
): StatusLook | undefined {
  return Object.hasOwn(statuses, status) ? statuses[status] : undefined;
}

/**
 * A status as a badge, from the app's map, with its raw text in `outline` when the map has no
 * entry for it.
 *
 * @param props - The status, the map it is looked up in, and the badge's class.
 * @returns The badge.
 */
export function StatusBadge<Status extends string>({
  status,
  statuses,
  className,
}: StatusBadgeProps<Status>) {
  const look = lookUp(statuses, status);
  return (
    <Badge variant={look?.variant ?? UNKNOWN_VARIANT} className={className}>
      {look?.iconSlot}
      {look?.label ?? status}
    </Badge>
  );
}
