import { SettingRow } from '@affine/component/setting-components';
import { ConfirmModal } from '@affine/component/ui/modal';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import {
  type Workspace,
  WorkspaceService,
} from '@affine/core/modules/workspace';
import type { DocImpl } from '@affine/core/modules/workspace/impls/doc';
import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { useLiveData, useServiceOptional } from '@toeverything/infra';
import { useCallback, useState } from 'react';

interface CleanupSummary {
  docs: number;
  blocks: number;
}

async function clearAllCreators(workspace: Workspace): Promise<CleanupSummary> {
  const collection = workspace.docCollection;
  const docIds = Array.from(collection.docs.keys());
  let blockCount = 0;

  for (const docId of docIds) {
    const doc = collection.getDoc(docId) as DocImpl | undefined;
    if (!doc) continue;
    if (!doc.ready) {
      doc.load();
    }
    const store = doc.getStore();
    const models = store.getAllModels();
    const targets = models.filter(
      m => m.keys.includes('meta:createdBy') && m.props['meta:createdBy']
    );
    if (targets.length === 0) continue;
    store.withoutTransact(() => {
      for (const m of targets) {
        m.props['meta:createdBy'] = undefined;
        blockCount += 1;
      }
    });
  }

  return { docs: docIds.length, blocks: blockCount };
}

export const ClearCreatorsPanel = () => {
  // useServiceOptional + LiveData fallback so a missing permission service
  // (e.g., local-only workspace contexts) doesn't blank the whole panel.
  const workspaceService = useServiceOptional(WorkspaceService);
  const workspace = workspaceService?.workspace;
  const permissionService = useServiceOptional(WorkspacePermissionService);
  const isOwnerOrAdmin = useLiveData(
    permissionService?.permission.isOwnerOrAdmin$ ?? null
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (!workspace) return;
    setRunning(true);
    try {
      const summary = await clearAllCreators(workspace);
      setResultMsg(
        `Cleared meta:createdBy on ${summary.blocks} block(s) across ${summary.docs} doc(s).`
      );
    } catch (err) {
      console.error('[mojo cleanup] clearAllCreators failed', err);
      setResultMsg('Failed — see browser console for details.');
    } finally {
      setRunning(false);
      setConfirmOpen(false);
    }
  }, [workspace]);

  // Hide for non-admins. If permission state hasn't resolved yet (null),
  // also hide — better to show nothing than to flash the button to a
  // member who shouldn't see it.
  if (!isOwnerOrAdmin) return null;
  if (!workspace) return null;

  return (
    <>
      <SettingRow
        name={
          <span style={{ color: 'var(--affine-warning-color)' }}>
            Clear all card creators
          </span>
        }
        desc="One-time cleanup: removes meta:createdBy from every block in this workspace. Use only if My Deadlines / Created by me are showing cards you didn't create. Cannot be undone — actual creator metadata for legitimately-created blocks is also wiped. Subsequent edits will not re-attribute authorship."
        style={{ cursor: running ? 'wait' : 'pointer' }}
        onClick={() => {
          if (!running) setConfirmOpen(true);
        }}
        data-testid="clear-creators"
      >
        <ArrowRightSmallIcon />
      </SettingRow>
      {resultMsg ? (
        <div
          style={{
            padding: '8px 16px',
            color: 'var(--affine-text-secondary-color)',
            fontSize: 13,
          }}
        >
          {resultMsg}
        </div>
      ) : null}
      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Clear all card creators?"
        description="This walks every doc in the workspace and removes the meta:createdBy field from every block. After this, My Deadlines will only filter by member assignment until cards get edited again. Continue?"
        cancelText="Cancel"
        confirmText={running ? 'Clearing…' : 'Clear creators'}
        confirmButtonOptions={{
          variant: 'error',
          loading: running,
        }}
        onConfirm={handleConfirm}
      />
    </>
  );
};
