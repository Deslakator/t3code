export function createKeepAwakeController(blocker: {
  start: (type: "prevent-app-suspension") => number;
  stop: (id: number) => void;
}) {
  let id: number | undefined;
  return (enabled: boolean) => {
    if (enabled && id === undefined) id = blocker.start("prevent-app-suspension");
    else if (!enabled && id !== undefined) {
      blocker.stop(id);
      id = undefined;
    }
  };
}
