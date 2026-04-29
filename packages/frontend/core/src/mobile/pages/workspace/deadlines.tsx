import { SafeArea, useThemeColorV2 } from '@affine/component';
import { AuthService } from '@affine/core/modules/cloud';
import {
  type DeadlineEntry,
  DeadlineIndexService,
} from '@affine/core/modules/deadline';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { useLiveData, useService } from '@toeverything/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useMemo, useState } from 'react';

import { AppTabs, PageHeader } from '../../components';

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(deadline: number, todayStart: number): string {
  const day = 24 * 60 * 60 * 1000;
  const diff = startOfDay(deadline) - todayStart;
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === day) return 'Tomorrow';
  if (diff <= 7 * day) return 'This week';
  return 'Upcoming';
}

const BUCKET_ORDER = [
  'Overdue',
  'Today',
  'Tomorrow',
  'This week',
  'Upcoming',
] as const;

export const DeadlinesPage = () => {
  useThemeColorV2('layer/background/mobile/primary');

  const deadlineIndex = useService(DeadlineIndexService);
  const authService = useService(AuthService);
  const workbench = useService(WorkbenchService).workbench;

  const all = useLiveData(deadlineIndex.deadlines$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const [nowSnapshot] = useState(() => Date.now());

  const visible = useMemo(() => {
    if (!currentUserId) return [];
    return all.filter(
      entry =>
        entry.deadline >= nowSnapshot &&
        (entry.createdBy === currentUserId ||
          entry.memberIds.includes(currentUserId))
    );
  }, [all, currentUserId, nowSnapshot]);

  const grouped = useMemo(() => {
    const todayStart = startOfDay(nowSnapshot);
    const buckets: Record<string, DeadlineEntry[]> = {
      Overdue: [],
      Today: [],
      Tomorrow: [],
      'This week': [],
      Upcoming: [],
    };
    for (const entry of visible) {
      const key = bucketFor(entry.deadline, todayStart);
      buckets[key]?.push(entry);
    }
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => a.deadline - b.deadline);
    }
    return buckets;
  }, [visible, nowSnapshot]);

  const handleOpen = useCallback(
    (entry: DeadlineEntry) => {
      workbench.openDoc(
        { docId: entry.docId, databaseRowId: entry.rowId },
        { at: 'active' }
      );
    },
    [workbench]
  );

  const isEmpty = visible.length === 0;

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: cssVarV2('layer/background/mobile/primary'),
        }}
      >
        <PageHeader back contentClassName="mobile-deadlines-header-content">
          Deadlines
        </PageHeader>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px 96px 16px',
          }}
        >
          {isEmpty ? (
            <div
              style={{
                padding: '40px 16px',
                color: cssVarV2('text/secondary'),
                textAlign: 'center',
                fontSize: 15,
              }}
            >
              No deadlines assigned to you.
            </div>
          ) : (
            BUCKET_ORDER.map(bucket => {
              const items = grouped[bucket];
              if (!items || items.length === 0) return null;
              return (
                <section key={bucket} style={{ marginBottom: 24 }}>
                  <h3
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: 14,
                      fontWeight: 600,
                      color: cssVarV2('text/secondary'),
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    {bucket}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: cssVarV2('text/tertiary'),
                      }}
                    >
                      {items.length}
                    </span>
                  </h3>
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {items.map(entry => (
                      <li
                        key={entry.id}
                        onClick={() => handleOpen(entry)}
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          background: cssVarV2(
                            'layer/background/mobile/secondary'
                          ),
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          cursor: 'pointer',
                          WebkitTapHighlightColor: 'transparent',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 500,
                            color: cssVarV2('text/primary'),
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {entry.title || 'Untitled card'}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            color: cssVarV2('text/secondary'),
                          }}
                        >
                          {new Date(entry.deadline).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
      <SafeArea bottom>
        <AppTabs background={cssVarV2('layer/background/mobile/primary')} />
      </SafeArea>
    </>
  );
};

export const Component = () => <DeadlinesPage />;
