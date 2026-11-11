import type { KeepAwakeState } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { toastManager } from "../../components/ui/toast";

export function useKeepAwakeState() {
  const [state, setState] = useState<KeepAwakeState>({ mode: "normal", busy: false });
  const [ready, setReady] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribe to the main process, which owns sleep prevention after windows close.
  useEffect(() => {
    const bridge = window.desktopBridge;
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = bridge?.onKeepAwakeState?.((value) => {
      receivedEvent = true;
      setState(value);
      setReady(true);
    });
    void bridge
      ?.getKeepAwakeState?.()
      .then((value) => {
        if (disposed || receivedEvent) return;
        setState(value);
        setReady(true);
      })
      .catch(reportError);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  const setMode = async (mode: KeepAwakeState["mode"]) => {
    try {
      const value = await window.desktopBridge?.setKeepAwakeMode?.(mode);
      if (value) setState(value);
    } catch (error) {
      reportError(error);
    }
  };
  return { ...state, ready, setMode };
}

function reportError(error: unknown) {
  toastManager.add({
    type: "error",
    title: "Could not update Mac sleep settings",
    description: String(error),
  });
}
