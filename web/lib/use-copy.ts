import { useState } from "react";
import { toast } from "sonner";

/**
 * The old way to copy, for the pages that are not allowed to use the new one.
 *
 * Returns whether it worked: `execCommand` reports a refusal by returning false rather than by
 * throwing, so a caller that only catches sees a silent no-op as a success.
 */
function copyTheOldWay(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    return document.execCommand("copy");
  } finally {
    area.remove();
  }
}

/**
 * Copy to the clipboard from a page that is often not permitted to.
 *
 * `navigator.clipboard` exists only in a secure context, and this server is as often as not
 * reached over plain http at a LAN address, where it is simply absent — so the deprecated
 * hidden-textarea route is not a legacy fallback here, it is the one that runs. Both call sites
 * had grown a fallback of their own and they had drifted apart: one copied, the other selected
 * the text and left the user to finish the job.
 *
 * `copied` is the button's own "done" state, and clears itself after a moment.
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    let ok = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      // A clipboard that exists can still refuse — an unfocused document, a denied permission.
    }
    if (!ok) ok = copyTheOldWay(text);

    if (!ok) {
      toast.error("Could not copy. Select the text and copy it by hand.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return { copied, copy };
}
