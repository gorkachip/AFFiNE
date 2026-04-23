import { Button, Modal, RadioGroup } from '@affine/component';
import { AuthService } from '@affine/core/modules/cloud';
import type { FolderNode } from '@affine/core/modules/organize';
import {
  parseVisibility,
  serializeVisibility,
} from '@affine/core/modules/organize';
import { WorkspaceMembersService } from '@affine/core/modules/permissions';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface FolderShareDialogProps {
  folder: FolderNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const checkboxStyle = {
  WebkitAppearance: 'checkbox',
  MozAppearance: 'checkbox',
  appearance: 'checkbox',
  width: '16px',
  height: '16px',
  cursor: 'pointer',
  flexShrink: 0,
} as const;

/**
 * MOJO folder visibility dialog. Lets the workspace decide whether a folder
 * shows for everyone or only a chosen subset of workspace members.
 *
 * Phase 1: UI-only filter. Data still syncs to all clients via Yjs.
 *
 * Safety nets:
 * - On save in 'restricted' mode, automatically include the current user's ID
 *   so they can't lock themselves out of folders they own.
 * - Checkboxes use forced appearance: checkbox to override the global
 *   `-webkit-appearance: none` reset on inputs.
 */
export const FolderShareDialog = ({
  folder,
  open,
  onOpenChange,
}: FolderShareDialogProps) => {
  const membersService = useService(WorkspaceMembersService);
  const authService = useService(AuthService);
  const members = membersService.members;
  const pageMembers = useLiveData(members.pageMembers$);
  const memberCount = useLiveData(members.memberCount$);
  const isLoading = useLiveData(members.isLoading$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );

  const folderName = useLiveData(folder.name$);
  const visibilityRaw = useLiveData(folder.visibility$);
  const initial = useMemo(
    () => parseVisibility(visibilityRaw),
    [visibilityRaw]
  );

  const [mode, setMode] = useState<'public' | 'restricted'>(initial.mode);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
    new Set(initial.users)
  );

  useEffect(() => {
    if (open) {
      // Default: include current user so they always see the folder.
      const seed = new Set(initial.users);
      if (currentUserId) seed.add(currentUserId);
      setMode(initial.mode);
      setSelectedUsers(seed);
      members.setPageNum(0);
      members.revalidate();
    }
  }, [open, initial.mode, initial.users, members, currentUserId]);

  const toggleUser = useCallback(
    (userId: string) => {
      setSelectedUsers(prev => {
        const next = new Set(prev);
        if (next.has(userId)) {
          // Don't allow user to remove themselves — they would lose access.
          if (userId === currentUserId) return prev;
          next.delete(userId);
        } else {
          next.add(userId);
        }
        return next;
      });
    },
    [currentUserId]
  );

  const handleSave = useCallback(() => {
    if (mode === 'public') {
      // Write an explicit empty string so the ORM overwrites any prior
      // 'restricted' JSON. parseVisibility() treats '' as public.
      folder.setVisibility('');
    } else {
      // Always include the current user as a safety net.
      const users = new Set(selectedUsers);
      if (currentUserId) users.add(currentUserId);
      const serialized = serializeVisibility({
        mode: 'restricted',
        users: Array.from(users),
      });
      folder.setVisibility(serialized ?? '');
    }
    onOpenChange(false);
  }, [folder, mode, onOpenChange, selectedUsers, currentUserId]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Share folder: ${folderName ?? ''}`}
      description="Choose who can see this folder. You will always see folders you share."
      width={520}
    >
      <div style={{ padding: '8px 0 16px' }}>
        <RadioGroup
          value={mode}
          onChange={v => setMode(v as 'public' | 'restricted')}
          items={[
            { value: 'public', label: 'Workspace (everyone)' },
            { value: 'restricted', label: 'Specific people' },
          ]}
        />
      </div>

      {mode === 'restricted' && (
        <div
          style={{
            maxHeight: 320,
            overflowY: 'auto',
            border: '1px solid var(--affine-border-color)',
            borderRadius: 8,
            padding: 8,
            marginBottom: 16,
          }}
        >
          {isLoading && !pageMembers ? (
            <div style={{ padding: 16, textAlign: 'center' }}>Loading…</div>
          ) : pageMembers && pageMembers.length > 0 ? (
            pageMembers.map(m => {
              const isSelf = m.id === currentUserId;
              return (
                <label
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 6px',
                    cursor: isSelf ? 'not-allowed' : 'pointer',
                    opacity: isSelf ? 0.7 : 1,
                  }}
                  title={isSelf ? 'You always have access' : ''}
                >
                  <input
                    type="checkbox"
                    style={checkboxStyle}
                    checked={selectedUsers.has(m.id)}
                    disabled={isSelf}
                    onChange={() => toggleUser(m.id)}
                  />
                  <span>
                    {m.name ?? m.email ?? m.id}
                    {isSelf ? ' (you)' : ''}
                  </span>
                </label>
              );
            })
          ) : (
            <div style={{ padding: 16, textAlign: 'center' }}>
              No members loaded.
            </div>
          )}
          {memberCount !== undefined &&
            pageMembers &&
            memberCount > pageMembers.length && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--affine-text-secondary-color)',
                  textAlign: 'center',
                  paddingTop: 8,
                }}
              >
                Showing {pageMembers.length} of {memberCount}. Use the admin
                Members panel to manage larger workspaces.
              </div>
            )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={handleSave}>
          Save
        </Button>
      </div>
    </Modal>
  );
};
