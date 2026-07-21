export const DEBUG_PANEL_STORAGE_KEY = "homr.debug-panel-enabled.v1";

export function loadDebugPanelEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEBUG_PANEL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveDebugPanelEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEBUG_PANEL_STORAGE_KEY, String(enabled));
  } catch {
    // A disabled/full local store should not prevent changing the setting for this session.
  }
}
