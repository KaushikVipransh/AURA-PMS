/**
 * Local editable state, seeded once from server data.
 *
 * Every form in this app has the same shape: fetch what the server holds, copy
 * it into local state, let the person edit it, send it back. The obvious way to
 * write that is a `useEffect` that calls `setState` when the query resolves —
 * and all three pages did, until React's own lint rule flagged every one of
 * them: *"Calling setState synchronously within an effect can trigger cascading
 * renders."*
 *
 * It is right. An effect that sets state runs *after* a render, so the seeded
 * values are painted on the following pass, and every such effect adds a render
 * nobody asked for. The documented alternative is to adjust state **during**
 * render when the thing it derives from has changed — which React handles by
 * re-running the component before touching the DOM, with no extra commit.
 *
 * **Seeded once, deliberately.** Re-seeding whenever the query data changed
 * identity would discard whatever the person had typed the moment a background
 * refetch landed, which is the classic way an autosaving form eats work.
 */

import { useState, type Dispatch, type SetStateAction } from 'react';

export function useInitialisedFrom<Data, State>(
  data: Data | undefined,
  derive: (data: Data) => State,
  empty: State,
): readonly [State, Dispatch<SetStateAction<State>>, boolean] {
  const [state, setState] = useState<State>(empty);
  const [seeded, setSeeded] = useState(false);

  if (!seeded && data !== undefined) {
    // Adjusting state during render. React re-runs this component immediately
    // and never commits the intermediate result, so there is no flash of the
    // empty form and no second paint.
    setSeeded(true);
    setState(derive(data));
  }

  return [state, setState, seeded] as const;
}
