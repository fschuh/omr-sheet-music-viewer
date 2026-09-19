import { useMemo, useState } from "react";
import { emptyFingeringPolicy, fingeringDocumentId, parseFingeringPolicy, policyKey, type FingeringPolicy } from "./fingeringPolicy";

export function useFingeringPolicy(cachePath?: string) {
  const id = fingeringDocumentId(cachePath);
  const initial = useMemo(() => {
    try { return { policy: parseFingeringPolicy(id ? localStorage.getItem(policyKey(id)) : null, id ?? ""), error: "", invalid: false }; }
    catch (error) { return { policy: { ...emptyFingeringPolicy(id ?? ""), disabled: true }, error: String(error), invalid: true }; }
  }, [id]);
  const [saved, setSaved] = useState<{ initial: typeof initial; policy: FingeringPolicy; history: FingeringPolicy[]; error: string }>();
  const state = saved?.initial === initial ? saved : { ...initial, history: [] };
  const write = (policy: FingeringPolicy, history: FingeringPolicy[]) => {
    if (!id || initial.invalid) return;
    let error = "";
    try { localStorage.setItem(policyKey(id), JSON.stringify(policy)); }
    catch { error = "Exclusions changed for this session but could not be saved"; }
    setSaved({ initial, policy, history, error });
  };
  return { policy: state.policy, error: state.error, available: Boolean(id) && !initial.invalid,
    canUndo: state.history.length > 0,
    change: (next: FingeringPolicy) => write(next, [...state.history, state.policy].slice(-20)),
    undo: () => { const previous = state.history.at(-1); if (previous) write(previous, state.history.slice(0, -1)); },
  };
}
