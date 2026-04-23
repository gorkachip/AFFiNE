import { Button, Modal, RadioGroup } from '@affine/component';
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

/**
 * MOJO folder visibility dialog. Lets the workspace decide whether a folder
 * shows for everyone or only a chosen subset of workspace members.
 *
 * Phase 1: UI-only filter. Data still syncs to all clients via Yjs.
 */
export const FolderShareDialog = ({
  folder,
  open,
  onOpenChange,
}: FolderShareDialogProps) => {
  const membersService = useService(WorkspaceMembersService);
  const members = membersService.members;
  const pageMembers = useLiveData(members.pageMembers$);
  const memberCount = useLiveData(members.memberCount$);
  const isLoading = useLiveData(members.isLoading$);

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
      setMode(initial.mode);
      setSelectedUsers(new Set(initial.users));
      // Walk pages to gather all members. PAGE_SIZE = 8 in entity.
      members.setPageNum(0);
      members.revalidate();
    }
  }, [open, initial.mode, initial.users, members]);

  const toggleUser = useCallback((userId: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    const next =
      mode === 'public'
        ? undefined
        : serializeVisibility({ mode, users: Array.from(selectedUsers) });
    folder.setVisibility(next);
    onOpenChange(false);
  }, [folder, mode, onOpenChange, selectedUsers]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Share folder: ${folderName ?? ''}`}
      description="Choose who can see this folder. Sub-docs will follow the folder's visibility."
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
            pageMembers.map(m => (
              <label
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 6px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedUsers.has(m.id)}
                  onChange={() => toggleUser(m.id)}
                />
                <span>{m.name ?? m.email ?? m.id}</span>
              </label>
            ))
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
                Showing {pageMembers.length} of {memberCount}. Use admin Members
                panel to manage larger workspaces.
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
