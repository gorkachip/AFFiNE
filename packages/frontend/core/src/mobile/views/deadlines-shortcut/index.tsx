import { AuthService } from '@affine/core/modules/cloud';
import { DeadlineIndexService } from '@affine/core/modules/deadline';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { DateTimeIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useMemo, useState } from 'react';

export const DeadlinesShortcut = () => {
  const deadlineIndex = useService(DeadlineIndexService);
  const authService = useService(AuthService);
  const workbench = useService(WorkbenchService).workbench;

  const all = useLiveData(deadlineIndex.deadlines$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const [nowSnapshot] = useState(() => Date.now());

  const counts = useMemo(() => {
    if (!currentUserId) return { upcoming: 0, overdue: 0 };
    let upcoming = 0;
    let overdue = 0;
    for (const e of all) {
      const mine =
        e.createdBy === currentUserId || e.memberIds.includes(currentUserId);
      if (!mine) continue;
      if (e.deadline < nowSnapshot) {
        overdue += 1;
      } else {
        upcoming += 1;
      }
    }
    return { upcoming, overdue };
  }, [all, currentUserId, nowSnapshot]);

  const handleOpen = useCallback(() => {
    workbench.open('/deadlines', { at: 'active' });
  }, [workbench]);

  if (counts.upcoming === 0 && counts.overdue === 0) return null;

  return (
    <button
      type="button"
      onClick={handleOpen}
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        margin: '0 16px 12px 16px',
        borderRadius: 12,
        background: cssVarV2('layer/background/mobile/secondary'),
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
      aria-label="Open deadlines"
    >
      <DateTimeIcon style={{ fontSize: 22, color: cssVarV2('text/primary') }} />
      <span
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: cssVarV2('text/primary'),
          flex: 1,
        }}
      >
        Deadlines
      </span>
      {counts.overdue > 0 ? (
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: cssVarV2('status/error'),
          }}
        >
          {counts.overdue} overdue
        </span>
      ) : null}
      <span
        style={{
          fontSize: 13,
          color: cssVarV2('text/secondary'),
        }}
      >
        {counts.upcoming} upcoming
      </span>
    </button>
  );
};
