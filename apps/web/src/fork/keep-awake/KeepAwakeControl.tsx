import { MoonIcon, CoffeeIcon, SunIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
} from "../../components/ui/menu";
import { useKeepAwakeState } from "./state";

const modes = [
  { value: "normal", label: "Normal sleep", icon: MoonIcon },
  { value: "tasks", label: "Keep awake until tasks finish", icon: CoffeeIcon },
  { value: "always", label: "Always keep awake", icon: SunIcon },
] as const;

function MacKeepAwakeControl() {
  const { mode, busy, ready, setMode } = useKeepAwakeState();
  const selected = modes.find((entry) => entry.value === mode) ?? modes[0];
  const Icon = selected.icon;
  const label =
    mode === "tasks"
      ? `${selected.label}: ${busy ? "tasks running or awaiting limit reset" : "no active tasks"}`
      : selected.label;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            disabled={!ready}
          />
        }
      >
        <Icon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            const selected = modes.find((entry) => entry.value === value);
            if (selected) void setMode(selected.value);
          }}
        >
          {modes.map(({ value, label, icon: ModeIcon }) => (
            <MenuRadioItem key={value} value={value}>
              <span className="flex items-center gap-2">
                <ModeIcon />
                {label}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

export function KeepAwakeControl() {
  return window.desktopBridge?.getClientPlatform() === "darwin" &&
    window.desktopBridge.setKeepAwakeMode ? (
    <MacKeepAwakeControl />
  ) : null;
}
