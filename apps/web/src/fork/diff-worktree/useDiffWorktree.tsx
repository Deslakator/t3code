import { worktreeReviewSection } from "./reviewSection";
import { useId, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { GitBranchIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/menu";
import { useEnvironmentQuery } from "~/state/query";
import { revisionedQuery } from "~/state/revisionedQuery";
import { vcsEnvironment } from "~/state/vcs";
import { useDiffPanelStore } from "~/diffPanelStore";
import { selectedDiffWorktree, useDiffWorktreeStore } from "./store";

export function useDiffWorktree({
  threadRef,
  projectCwd,
  defaultCwd,
  enabled,
}: {
  threadRef: ScopedThreadRef | null;
  projectCwd: string | undefined;
  defaultCwd: string | undefined;
  enabled: boolean;
}) {
  const instanceId = useId();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [revision, setRevision] = useState(0);
  const selected = useDiffWorktreeStore((state) =>
    selectedDiffWorktree(state.paths, threadRef, projectCwd),
  );
  const refs = useEnvironmentQuery(
    open && enabled && threadRef && projectCwd
      ? revisionedQuery(
          vcsEnvironment.listRefs({
            environmentId: threadRef.environmentId,
            input: { cwd: projectCwd, refKind: "local", limit: 100, cursor, refresh: true },
          }),
          `diff-worktrees:${instanceId}:${revision}`,
        )
      : null,
  );
  const nextCursor = refs.data?.nextCursor;
  const choices = new Map<string, string>();
  for (const ref of refs.data?.refs ?? []) {
    if (ref.worktreePath && ref.worktreePath !== defaultCwd)
      choices.set(ref.worktreePath, ref.name);
  }
  const cwd = enabled ? (selected ?? defaultCwd) : defaultCwd;
  const picker =
    enabled && threadRef && projectCwd ? (
      <DropdownMenu
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setCursor(0);
            setRevision((previous) => previous + 1);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
            <DropdownMenuTrigger
              render={<Button size="xs" variant="secondary" />}
              aria-label="Diff worktree"
            >
              <GitBranchIcon className="size-3.5" />
              <span className="max-w-28 truncate">
                {selected ? selected.split(/[\\/]/).at(-1) : "Thread folder"}
              </span>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipPopup>{cwd}</TooltipPopup>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={selected ?? ""}
            onValueChange={(value) => {
              useDiffWorktreeStore.getState().select(threadRef, projectCwd, value || null);
              useDiffPanelStore.getState().selectBranchBaseRef(threadRef, null);
            }}
          >
            <DropdownMenuRadioItem value="" closeOnClick>
              <span className="flex min-w-0 flex-col">
                <span>Thread folder</span>
                <span className="max-w-96 whitespace-normal break-all text-xs text-muted-foreground">
                  {defaultCwd}
                </span>
              </span>
            </DropdownMenuRadioItem>
            {selected && !choices.has(selected) ? (
              <DropdownMenuRadioItem value={selected} closeOnClick>
                <span className="max-w-96 whitespace-normal break-all">{selected}</span>
              </DropdownMenuRadioItem>
            ) : null}
            {[...choices].map(([path, branch]) => (
              <DropdownMenuRadioItem key={path} value={path} closeOnClick>
                <span className="flex min-w-0 flex-col">
                  <span>{branch}</span>
                  <span className="max-w-96 whitespace-normal break-all text-xs text-muted-foreground">
                    {path}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {refs.isPending ? <DropdownMenuItem disabled>Loading worktrees…</DropdownMenuItem> : null}
          {refs.error ? (
            <DropdownMenuItem onClick={refs.refresh}>
              Could not load worktrees. Retry
            </DropdownMenuItem>
          ) : null}
          {cursor > 0 ? (
            <DropdownMenuItem onClick={() => setCursor(0)}>First page</DropdownMenuItem>
          ) : null}
          {nextCursor != null ? (
            <DropdownMenuItem onClick={() => setCursor(nextCursor)}>
              More branches…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;
  return {
    cwd,
    picker,
    reviewSection: (id: string, title: string) =>
      worktreeReviewSection(id, title, enabled ? selected : undefined),
    fileThreadRef: enabled && selected ? null : threadRef,
    scopeSuffix: enabled && selected ? `:${selected}` : "",
    reviewFields: enabled && selected && projectCwd ? { worktreeProjectRoot: projectCwd } : {},
  };
}
