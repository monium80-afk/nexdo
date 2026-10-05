import { useEffect, useState } from "react";

import { dismissAuthSession, runAuthSession } from "@/lib/authSession";

/**
 * Google/Apple sign-in for the sign-in and sign-up screens, one at a time.
 * `pending` is true while this screen's sign-in is open, so its buttons can
 * show as disabled. A sheet still open when the screen goes away is closed.
 */
export function useSocialAuthSession() {
  const [pending, setPending] = useState(false);

  useEffect(() => dismissAuthSession, []);

  const start = (flow: () => Promise<void>) =>
    runAuthSession(async () => {
      setPending(true);
      try {
        await flow();
      } finally {
        setPending(false);
      }
    });

  return { pending, start };
}
