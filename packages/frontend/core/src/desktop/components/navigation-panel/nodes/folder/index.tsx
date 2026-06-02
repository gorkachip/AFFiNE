import {
  AnimatedCollectionsIcon,
  AnimatedFolderIcon,
  type DropTargetDropEvent,
  type DropTargetOptions,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuSub,
  notify,
} from '@affine/component';
import { usePageHelper } from '@affine/core/blocksuite/block-suite-page-list/utils';
import { AuthService } from '@affine/core/modules/cloud';
import { WorkspaceDialogService } from '@affine/core/modules/dialogs';
import { CompatibleFavoriteItemsAdapter } from '@affine/core/modules/favorite';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { NavigationPanelService } from '@affine/core/modules/navigation-panel';
import {
  canUserSeeFolder,
  type FolderNode,
  OrganizeService,
  parseLock,
  serializeLock,
} from '@affine/core/modules/organize';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { WorkspaceService } from '@affine/core/modules/workspace';
import type { AffineDNDData } from '@affine/core/types/dnd';
import { Unreachable } from '@affine/env/constant';
import { useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import {
  DeleteIcon,
  FolderIcon,
  LockIcon,
  PageIcon,
  PlusIcon,
  PlusThickIcon,
  RemoveFolderIcon,
  ShareIcon,
  TagsIcon,
  UnlockIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService, useServices } from '@toeverything/infra';
import { difference } from 'lodash-es';
import { useCallback, useMemo, useState } from 'react';

import { FolderShareDialog } from '../../../../../components/folder-share-dialog';
import {
  NavigationPanelTreeNode,
  type NavigationPanelTreeNodeDropEffect,
} from '../../tree';
import type { NavigationPanelTreeNodeIcon } from '../../tree/node';
import type { NodeOperation } from '../../tree/types';
import { NavigationPanelCollectionNode } from '../collection';
import { NavigationPanelDocNode } from '../doc';
import { NavigationPanelTagNode } from '../tag';
import type { GenericNavigationPanelNode } from '../types';
import { FolderEmpty } from './empty';
import { FavoriteFolderOperation } from './operations';

export const NavigationPanelFolderNode = ({
  nodeId,
  onDrop,
  defaultRenaming,
  operations,
  location,
  dropEffect,
  canDrop,
  reorderable,
  parentPath,
}: {
  defaultRenaming?: boolean;
  nodeId: string;
  onDrop?: (data: DropTargetDropEvent<AffineDNDData>, node: FolderNode) => void;
  operations?:
    | NodeOperation[]
    | ((type: string, node: FolderNode) => NodeOperation[]);
} & Omit<GenericNavigationPanelNode, 'operations'>) => {
  const { organizeService } = useServices({
    OrganizeService,
  });
  const node = useLiveData(organizeService.folderTree.folderNode$(nodeId));
  const type = useLiveData(node?.type$);
  const data = useLiveData(node?.data$);
  const handleDrop = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (!node) {
        return;
      }
      onDrop?.(data, node);
    },
    [node, onDrop]
  );
  const additionalOperations = useMemo(() => {
    if (!type || !node) {
      return;
    }
    if (typeof operations === 'function') {
      return operations(type, node);
    }
    return operations;
  }, [node, operations, type]);

  if (!node) {
    return;
  }

  if (type === 'folder') {
    return (
      <NavigationPanelFolderNodeFolder
        node={node}
        onDrop={handleDrop}
        defaultRenaming={defaultRenaming}
        operations={additionalOperations}
        dropEffect={dropEffect}
        reorderable={reorderable}
        canDrop={canDrop}
        parentPath={parentPath}
      />
    );
  } else if (type === 'doc') {
    return (
      data && (
        <NavigationPanelDocNode
          docId={data}
          location={location}
          onDrop={handleDrop}
          reorderable={reorderable}
          canDrop={canDrop}
          dropEffect={dropEffect}
          operations={additionalOperations}
          parentPath={parentPath}
        />
      )
    );
  } else if (type === 'collection') {
    return (
      data && (
        <NavigationPanelCollectionNode
          collectionId={data}
          location={location}
          onDrop={handleDrop}
          canDrop={canDrop}
          reorderable={reorderable}
          dropEffect={dropEffect}
          operations={additionalOperations}
          parentPath={parentPath}
        />
      )
    );
  } else if (type === 'tag') {
    return (
      data && (
        <NavigationPanelTagNode
          tagId={data}
          location={location}
          onDrop={handleDrop}
          canDrop={canDrop}
          reorderable
          dropEffect={dropEffect}
          operations={additionalOperations}
          parentPath={parentPath}
        />
      )
    );
  }

  return;
};

// MOJO: walk a folder's descendants synchronously and report whether any
// of them is directly visible to the user. Used so that a parent folder
// the user can't see itself but contains a shared subfolder still appears
// in the sidebar as a passthrough so they can navigate down. The
// organizeService is passed so we can resolve EFFECTIVE visibility (which
// walks up through 'inherit' ancestors) instead of just the raw row.
function hasVisibleDescendant(
  node: FolderNode,
  userId: string | null,
  isOwnerOrAdmin: boolean,
  organizeService: OrganizeService
): boolean {
  for (const child of node.children$.value) {
    if (child.type$.value !== 'folder') continue;
    if (child.trashed$.value) continue;
    if (!child.id) continue;
    const v = organizeService.folderTree.resolveEffectiveVisibility(child.id);
    if (canUserSeeFolder(v, userId, isOwnerOrAdmin)) return true;
    if (hasVisibleDescendant(child, userId, isOwnerOrAdmin, organizeService))
      return true;
  }
  return false;
}

// Define outside the `NavigationPanelFolderNodeFolder` to avoid re-render(the close animation won't play)
const NavigationPanelFolderIcon: NavigationPanelTreeNodeIcon = ({
  collapsed,
  className,
  draggedOver,
  treeInstruction,
}) => (
  <AnimatedFolderIcon
    className={className}
    open={
      !collapsed || (!!draggedOver && treeInstruction?.type === 'make-child')
    }
  />
);

const NavigationPanelFolderNodeFolder = ({
  node,
  onDrop,
  defaultRenaming,
  location,
  operations: additionalOperations,
  canDrop,
  dropEffect,
  reorderable,
  parentPath,
}: {
  defaultRenaming?: boolean;
  node: FolderNode;
} & GenericNavigationPanelNode) => {
  const t = useI18n();
  const {
    workspaceService,
    featureFlagService,
    workspaceDialogService,
    authService,
    workspacePermissionService,
  } = useServices({
    WorkspaceService,
    CompatibleFavoriteItemsAdapter,
    FeatureFlagService,
    WorkspaceDialogService,
    AuthService,
    WorkspacePermissionService,
  });
  const navigationPanelService = useService(NavigationPanelService);
  const organizeService = useService(OrganizeService);
  const name = useLiveData(node.name$);
  const visibilityRaw = useLiveData(node.visibility$);
  const ownLockRaw = useLiveData(node.lock$);
  const ownLock = useMemo(() => parseLock(ownLockRaw), [ownLockRaw]);
  // MOJO: effective lock = own lock OR any locked ancestor. Without this,
  // descendants of a locked folder rendered as unlocked, so rename / new-
  // subfolder UI stayed enabled — and the store throw on submit froze the
  // inline editor.
  const effectiveLock = useLiveData(
    organizeService.folderTree.lockForFolder$(node.id ?? '')
  );
  const locked = effectiveLock !== null;
  // True only when the lock is inherited (this folder isn't directly
  // locked, but an ancestor is). Used to hide the Lock/Unlock toggle —
  // you can't unlock a node you didn't lock; do it at the ancestor.
  const lockInherited = locked && ownLock === null;
  // MOJO: workspace owners/admins bypass the lock entirely — they can
  // rename, create, move, delete inside any locked folder without
  // unlocking. The padlock badge still shows so they know it's locked.
  const createdBy = useLiveData(node.createdBy$);
  // MOJO: trashed folders are filtered out of the sidebar tree; they
  // surface in the dedicated Trash page instead.
  const trashed = useLiveData(node.trashed$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const isOwnerOrAdmin = useLiveData(
    workspacePermissionService.permission.isOwnerOrAdmin$
  );
  // MOJO: the gate the UI uses for hiding affordances — admins/owners
  // bypass, so `enforceLock` is false for them even when `locked` is true.
  const enforceLock = locked && !isOwnerOrAdmin;
  // MOJO: visibility is computed from the EFFECTIVE visibility — walks
  // up through any 'inherit' ancestors. That's how share-folder cascades
  // to subfolders without re-listing users at every level.
  const effectiveVisibility = useLiveData(
    organizeService.folderTree.effectiveVisibilityForFolder$(node.id ?? '')
  );
  const visible = useMemo(() => {
    return canUserSeeFolder(effectiveVisibility, currentUserId, !!isOwnerOrAdmin);
  }, [effectiveVisibility, currentUserId, isOwnerOrAdmin]);
  // Children list is read here (not just for rendering) so we can detect
  // whether the user has access to any descendant when they don't have
  // direct visibility on this folder. If they do, render this folder in
  // "passthrough" mode so they can navigate down into the shared sub-tree.
  const childrenSnapshot = useLiveData(node.children$);
  const passthrough = useMemo(() => {
    if (visible) return false;
    if (node.id === null) return false;
    // Touch the snapshot so the memo recomputes when children are added
    // or removed; visibility changes deeper in the tree are only picked
    // up on the next re-render rather than reactively (fine for the rare
    // event of a share toggle).
    void childrenSnapshot.length;
    return hasVisibleDescendant(
      node,
      currentUserId,
      !!isOwnerOrAdmin,
      organizeService
    );
  }, [visible, childrenSnapshot, currentUserId, isOwnerOrAdmin, node, organizeService]);
  const isCreator =
    !!currentUserId && !!createdBy && createdBy === currentUserId;
  // Creator, owners and admins can manage this folder (share visibility +
  // delete it). Regular collaborators can only touch folders they created.
  // Passthrough mode (parent of a shared subfolder) gets no management
  // controls regardless of who created it.
  const canManage = !passthrough && (isCreator || !!isOwnerOrAdmin);
  const enableEmojiIcon = useLiveData(
    featureFlagService.flags.enable_emoji_folder_icon.$
  );
  const path = useMemo(
    () => [...(parentPath ?? []), `folder-${node.id}`],
    [parentPath, node.id]
  );
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => {
      navigationPanelService.setCollapsed(path, value);
    },
    [navigationPanelService, path]
  );
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const { createPage } = usePageHelper(
    workspaceService.workspace.docCollection
  );
  const handleToggleLock = useCallback(() => {
    if (!isOwnerOrAdmin) {
      notify.error({
        title: 'Only admins can lock or unlock folders',
        message:
          'Ask a workspace owner or admin to change the lock state of this folder.',
      });
      return;
    }
    // MOJO: operate on the OWN lock — `locked` may be true because of an
    // ancestor, and unlocking a node that isn't directly locked is a no-op
    // (the inherited lock keeps applying). The menu entry is hidden in
    // that case, but stay defensive in case of stale callbacks.
    if (ownLock !== null) {
      node.setLock('');
      notify.success({ title: `"${name}" unlocked` });
    } else {
      const serialized = serializeLock({
        lockedBy: currentUserId ?? '',
        lockedAt: Date.now(),
      });
      if (serialized) {
        node.setLock(serialized);
        notify.success({
          title: `"${name}" locked`,
          message:
            'Docs and subfolders inside are now read-only. Only admins can unlock.',
        });
      }
    }
  }, [isOwnerOrAdmin, ownLock, node, name, currentUserId]);

  const handleDelete = useCallback(() => {
    if (enforceLock) {
      notify.error({
        title: 'Folder is locked',
        message:
          'Unlock the folder first before deleting it. Only admins can unlock.',
      });
      return;
    }
    if (!canManage) {
      notify.error({
        title: 'Cannot delete this folder',
        message:
          'Only the creator or a workspace admin can delete this folder. Ask an admin to remove it.',
      });
      return;
    }
    node.delete();
    track.$.navigationPanel.organize.deleteOrganizeItem({
      type: 'folder',
    });
    notify.success({
      title: t['com.affine.rootAppSidebar.organize.delete.notify-title']({
        name,
      }),
      message: t['com.affine.rootAppSidebar.organize.delete.notify-message'](),
    });
  }, [canManage, enforceLock, name, node, t]);

  const children = useLiveData(node.sortedChildren$);

  const dndData = useMemo(() => {
    if (!node.id) {
      throw new Unreachable();
    }
    return {
      draggable: {
        entity: {
          type: 'folder',
          id: node.id,
        },
        from: location,
      },
      dropTarget: {
        at: 'navigation-panel:organize:folder',
      },
    } satisfies AffineDNDData;
  }, [location, node.id]);

  const handleRename = useCallback(
    (newName: string) => {
      // MOJO: store-side guards (locked ancestor, missing node, etc) throw
      // synchronously. Without this catch the throw propagated out of the
      // inline editor and froze the sidebar; turn it into a toast.
      try {
        node.rename(newName);
      } catch (err) {
        notify.error({
          title: 'Cannot rename folder',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [node]
  );

  const handleDropOnFolder = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (data.source.data.entity?.type) {
        track.$.navigationPanel.folders.drop({
          type: data.source.data.entity.type,
        });
      }
      if (data.treeInstruction?.type === 'make-child') {
        if (data.source.data.entity?.type === 'folder') {
          if (
            node.id === data.source.data.entity.id ||
            node.beChildOf(data.source.data.entity.id)
          ) {
            return;
          }
          node.moveHere(data.source.data.entity.id, node.indexAt('before'));
          track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
        } else if (
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'tag'
        ) {
          if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            node.moveHere(data.source.data.from.nodeId, node.indexAt('before'));
            track.$.navigationPanel.organize.moveOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          } else {
            node.createLink(
              data.source.data.entity?.type,
              data.source.data.entity.id,
              node.indexAt('before')
            );
            track.$.navigationPanel.organize.createOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          }
        }
      } else {
        onDrop?.(data);
      }
    },
    [node, onDrop]
  );

  const handleDropEffect = useCallback<NavigationPanelTreeNodeDropEffect>(
    data => {
      if (data.treeInstruction?.type === 'make-child') {
        if (data.source.data.entity?.type === 'folder') {
          if (
            node.id === data.source.data.entity.id ||
            node.beChildOf(data.source.data.entity.id)
          ) {
            return;
          }
          return 'move';
        } else if (
          data.source.data.from?.at === 'navigation-panel:organize:folder-node'
        ) {
          return 'move';
        } else if (
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'tag'
        ) {
          return 'link';
        }
      } else {
        return dropEffect?.(data);
      }
      return;
    },
    [dropEffect, node]
  );

  const handleDropOnPlaceholder = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (data.source.data.entity?.type) {
        track.$.navigationPanel.folders.drop({
          type: data.source.data.entity.type,
        });
      }
      if (data.source.data.entity?.type === 'folder') {
        if (
          node.id === data.source.data.entity.id ||
          node.beChildOf(data.source.data.entity.id)
        ) {
          return;
        }
        node.moveHere(data.source.data.entity.id, node.indexAt('before'));
        track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
      } else if (
        data.source.data.entity?.type === 'collection' ||
        data.source.data.entity?.type === 'doc' ||
        data.source.data.entity?.type === 'tag'
      ) {
        if (
          data.source.data.from?.at === 'navigation-panel:organize:folder-node'
        ) {
          node.moveHere(data.source.data.from.nodeId, node.indexAt('before'));
          track.$.navigationPanel.organize.moveOrganizeItem({
            type: data.source.data.entity?.type,
          });
        } else {
          node.createLink(
            data.source.data.entity?.type,
            data.source.data.entity.id,
            node.indexAt('before')
          );
          track.$.navigationPanel.organize.createOrganizeItem({
            type: 'link',
            target: data.source.data.entity?.type,
          });
        }
      }
    },
    [node]
  );

  const handleDropOnChildren = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>, dropAtNode?: FolderNode) => {
      if (!dropAtNode || !dropAtNode.id) {
        return;
      }
      if (data.source.data.entity?.type) {
        track.$.navigationPanel.folders.drop({
          type: data.source.data.entity.type,
        });
      }
      if (
        data.treeInstruction?.type === 'reorder-above' ||
        data.treeInstruction?.type === 'reorder-below'
      ) {
        const at =
          data.treeInstruction?.type === 'reorder-below' ? 'after' : 'before';
        if (data.source.data.entity?.type === 'folder') {
          if (
            node.id === data.source.data.entity.id ||
            node.beChildOf(data.source.data.entity.id)
          ) {
            return;
          }
          node.moveHere(
            data.source.data.entity.id,
            node.indexAt(at, dropAtNode.id)
          );
          track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
        } else if (
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'tag'
        ) {
          if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            node.moveHere(
              data.source.data.from.nodeId,
              node.indexAt(at, dropAtNode.id)
            );
            track.$.navigationPanel.organize.moveOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          } else {
            node.createLink(
              data.source.data.entity?.type,
              data.source.data.entity.id,
              node.indexAt(at, dropAtNode.id)
            );

            track.$.navigationPanel.organize.createOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          }
        }
      } else if (data.treeInstruction?.type === 'reparent') {
        const currentLevel = data.treeInstruction.currentLevel;
        const desiredLevel = data.treeInstruction.desiredLevel;
        if (currentLevel === desiredLevel + 1) {
          onDrop?.({
            ...data,
            treeInstruction: {
              type: 'reorder-below',
              currentLevel,
              indentPerLevel: data.treeInstruction.indentPerLevel,
            },
          });
          return;
        } else {
          onDrop?.({
            ...data,
            treeInstruction: {
              ...data.treeInstruction,
              currentLevel: currentLevel - 1,
            },
          });
        }
      }
    },
    [node, onDrop]
  );

  const handleDropEffectOnChildren =
    useCallback<NavigationPanelTreeNodeDropEffect>(
      data => {
        if (
          data.treeInstruction?.type === 'reorder-above' ||
          data.treeInstruction?.type === 'reorder-below'
        ) {
          if (data.source.data.entity?.type === 'folder') {
            if (
              node.id === data.source.data.entity.id ||
              node.beChildOf(data.source.data.entity.id)
            ) {
              return;
            }
            return 'move';
          } else if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            return 'move';
          } else if (
            data.source.data.entity?.type === 'collection' ||
            data.source.data.entity?.type === 'doc' ||
            data.source.data.entity?.type === 'tag'
          ) {
            return 'link';
          }
        } else if (data.treeInstruction?.type === 'reparent') {
          const currentLevel = data.treeInstruction.currentLevel;
          const desiredLevel = data.treeInstruction.desiredLevel;
          if (currentLevel === desiredLevel + 1) {
            dropEffect?.({
              ...data,
              treeInstruction: {
                type: 'reorder-below',
                currentLevel,
                indentPerLevel: data.treeInstruction.indentPerLevel,
              },
            });
            return;
          } else {
            dropEffect?.({
              ...data,
              treeInstruction: {
                ...data.treeInstruction,
                currentLevel: currentLevel - 1,
              },
            });
          }
        }
        return;
      },
      [dropEffect, node]
    );

  const handleCanDrop = useMemo<DropTargetOptions<AffineDNDData>['canDrop']>(
    () => args => {
      const entityType = args.source.data.entity?.type;
      if (args.treeInstruction && args.treeInstruction?.type !== 'make-child') {
        return (
          (typeof canDrop === 'function' ? canDrop(args) : canDrop) ?? true
        );
      }

      if (args.source.data.entity?.type === 'folder') {
        if (
          node.id === args.source.data.entity.id ||
          node.beChildOf(args.source.data.entity.id)
        ) {
          return false;
        }
        return true;
      } else if (
        args.source.data.from?.at === 'navigation-panel:organize:folder-node'
      ) {
        return true;
      } else if (
        entityType === 'collection' ||
        entityType === 'doc' ||
        entityType === 'tag'
      ) {
        return true;
      }
      return false;
    },
    [canDrop, node]
  );

  const handleChildrenCanDrop = useMemo<
    DropTargetOptions<AffineDNDData>['canDrop']
  >(
    () => args => {
      const entityType = args.source.data.entity?.type;

      if (args.source.data.entity?.type === 'folder') {
        if (
          node.id === args.source.data.entity.id ||
          node.beChildOf(args.source.data.entity.id)
        ) {
          return false;
        }
        return true;
      } else if (
        args.source.data.from?.at === 'navigation-panel:organize:folder-node'
      ) {
        return true;
      } else if (
        entityType === 'collection' ||
        entityType === 'doc' ||
        entityType === 'tag'
      ) {
        return true;
      }
      return false;
    },
    [node]
  );

  const handleNewDoc = useCallback(() => {
    // MOJO: store throws if any ancestor is locked — turn into a toast.
    try {
      const newDoc = createPage();
      node.createLink('doc', newDoc.id, node.indexAt('before'));
      track.$.navigationPanel.folders.createDoc();
      track.$.navigationPanel.organize.createOrganizeItem({
        type: 'link',
        target: 'doc',
      });
      setCollapsed(false);
    } catch (err) {
      notify.error({
        title: 'Cannot add doc',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [createPage, node, setCollapsed]);

  const handleCreateSubfolder = useCallback(() => {
    // MOJO: store throws if this parent (or an ancestor) is locked.
    try {
      const newFolderId = node.createFolder(
        t['com.affine.rootAppSidebar.organize.new-folders'](),
        node.indexAt('before'),
        currentUserId ?? undefined
      );
      track.$.navigationPanel.organize.createOrganizeItem({ type: 'folder' });
      setCollapsed(false);
      setNewFolderId(newFolderId);
    } catch (err) {
      notify.error({
        title: 'Cannot create subfolder',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [currentUserId, node, setCollapsed, t]);

  const handleAddToFolder = useCallback(
    (type: 'doc' | 'collection' | 'tag') => {
      const initialIds = children
        .filter(node => node.type$.value === type)
        .map(node => node.data$.value)
        .filter(Boolean) as string[];
      const selector =
        type === 'doc'
          ? 'doc-selector'
          : type === 'collection'
            ? 'collection-selector'
            : 'tag-selector';
      workspaceDialogService.open(
        selector,
        {
          init: initialIds,
        },
        selectedIds => {
          if (selectedIds === undefined) {
            return;
          }
          const newItemIds = difference(selectedIds, initialIds);
          const removedItemIds = difference(initialIds, selectedIds);
          const removedItems = children.filter(
            node =>
              !!node.data$.value && removedItemIds.includes(node.data$.value)
          );

          newItemIds.forEach(id => {
            node.createLink(type, id, node.indexAt('after'));
          });
          removedItems.forEach(node => node.delete());
          const updated = newItemIds.length + removedItems.length;
          updated && setCollapsed(false);
        }
      );
      track.$.navigationPanel.organize.createOrganizeItem({
        type: 'link',
        target: type,
      });
    },
    [children, node, setCollapsed, workspaceDialogService]
  );

  const folderOperations = useMemo(() => {
    // MOJO: passthrough mode means the user only sees this folder so they
    // can navigate down into a shared subfolder — no content controls.
    if (passthrough) {
      return [
        {
          index: 200,
          view: node.id ? <FavoriteFolderOperation id={node.id} /> : null,
        },
      ];
    }
    // MOJO: anyone in the workspace can add content (subfolders, docs,
    // tags, collections) into any folder. Only the folder's creator
    // (or a workspace owner/admin) can rename / share / delete the
    // folder itself.
    return [
      // MOJO: hide the inline "+" when the folder is locked for THIS user
      // (admins/owners bypass and keep adding content into locked folders).
      ...(enforceLock
        ? []
        : [
            {
              index: 0,
              inline: true,
              view: (
                <IconButton
                  size="16"
                  onClick={handleNewDoc}
                  tooltip={t[
                    'com.affine.rootAppSidebar.explorer.organize-add-tooltip'
                  ]()}
                >
                  <PlusIcon />
                </IconButton>
              ),
            },
          ]),
      // MOJO: padlock indicator next to the "+" button when the folder
      // is locked. Non-interactive — clicking it just shows a tooltip-y
      // toast. Visible to everyone, not just admins, so collaborators
      // know why they can't edit.
      ...(locked
        ? [
            {
              index: 1,
              inline: true,
              view: (
                <IconButton
                  size="16"
                  onClick={e => {
                    e.stopPropagation();
                    notify.info({
                      title: 'Folder is locked',
                      message:
                        'Docs inside are read-only. Only admins can unlock.',
                    });
                  }}
                  tooltip="Locked — read-only"
                >
                  <LockIcon />
                </IconButton>
              ),
            },
          ]
        : []),
      ...(canManage
        ? [
            {
              index: 99,
              view: (
                <MenuItem
                  prefixIcon={<ShareIcon />}
                  onClick={() => setShareOpen(true)}
                >
                  Share folder
                </MenuItem>
              ),
            },
          ]
        : []),
      // MOJO: Lock / Unlock entry. Only workspace owners/admins see it.
      // Hide it entirely when the lock is inherited from a parent — the
      // toggle would lie ("Unlock" does nothing because this node isn't
      // directly locked); the admin must unlock at the ancestor.
      ...(isOwnerOrAdmin && !lockInherited
        ? [
            {
              index: 98,
              view: (
                <MenuItem
                  prefixIcon={ownLock !== null ? <UnlockIcon /> : <LockIcon />}
                  onClick={handleToggleLock}
                >
                  {ownLock !== null ? 'Unlock folder' : 'Lock folder'}
                </MenuItem>
              ),
            },
          ]
        : []),
      // MOJO: hide add-content entries when the lock applies to THIS user
      // (admins/owners bypass — they keep these affordances).
      ...(enforceLock
        ? []
        : [
            {
              index: 100,
              view: (
                <MenuItem
                  prefixIcon={<FolderIcon />}
                  onClick={handleCreateSubfolder}
                >
                  {t[
                    'com.affine.rootAppSidebar.organize.folder.create-subfolder'
                  ]()}
                </MenuItem>
              ),
            },
            {
              index: 101,
              view: (
                <MenuItem
                  prefixIcon={<PageIcon />}
                  onClick={() => handleAddToFolder('doc')}
                >
                  {t['com.affine.rootAppSidebar.organize.folder.add-docs']()}
                </MenuItem>
              ),
            },
            {
              index: 102,
              view: (
                <MenuSub
                  triggerOptions={{
                    prefixIcon: <PlusThickIcon />,
                  }}
                  items={
                    <>
                      <MenuItem
                        onClick={() => handleAddToFolder('tag')}
                        prefixIcon={<TagsIcon />}
                      >
                        {t[
                          'com.affine.rootAppSidebar.organize.folder.add-tags'
                        ]()}
                      </MenuItem>
                      <MenuItem
                        onClick={() => handleAddToFolder('collection')}
                        prefixIcon={<AnimatedCollectionsIcon closed={false} />}
                      >
                        {t[
                          'com.affine.rootAppSidebar.organize.folder.add-collections'
                        ]()}
                      </MenuItem>
                    </>
                  }
                >
                  {t['com.affine.rootAppSidebar.organize.folder.add-others']()}
                </MenuSub>
              ),
            },
          ]),

      {
        index: 200,
        view: node.id ? <FavoriteFolderOperation id={node.id} /> : null,
      },

      ...(canManage
        ? [
            {
              index: 9999,
              view: <MenuSeparator key="menu-separator" />,
            },
            {
              index: 10000,
              view: (
                <MenuItem
                  type={'danger'}
                  prefixIcon={<DeleteIcon />}
                  onClick={handleDelete}
                >
                  {t['com.affine.rootAppSidebar.organize.delete']()}
                </MenuItem>
              ),
            },
          ]
        : []),
    ];
  }, [
    handleAddToFolder,
    handleCreateSubfolder,
    handleDelete,
    handleNewDoc,
    handleToggleLock,
    canManage,
    isOwnerOrAdmin,
    locked,
    enforceLock,
    lockInherited,
    ownLock,
    passthrough,
    node,
    t,
  ]);

  const finalOperations = useMemo(() => {
    if (additionalOperations) {
      return [...additionalOperations, ...folderOperations];
    }
    return folderOperations;
  }, [additionalOperations, folderOperations]);

  const childrenOperations = useCallback(
    (type: string, node: FolderNode) => {
      // MOJO: only the folder creator (or a workspace admin/owner) can
      // "Remove from folder" items under a folder. Collaborators who did
      // not create the folder cannot mutate its contents. A locked
      // folder also hides the entry — admins must unlock first.
      // Admins/owners bypass — they can remove items from inside locked
      // folders without unlocking; regular creators still need to unlock.
      if (!canManage || enforceLock) {
        return [] satisfies NodeOperation[];
      }
      if (type === 'doc' || type === 'collection' || type === 'tag') {
        return [
          {
            index: 999,
            view: (
              <MenuItem
                type={'danger'}
                prefixIcon={<RemoveFolderIcon />}
                data-event-props="$.navigationPanel.organize.deleteOrganizeItem"
                data-event-args-type={node.type$.value}
                onClick={() => node.delete()}
              >
                {t['com.affine.rootAppSidebar.organize.delete-from-folder']()}
              </MenuItem>
            ),
          },
        ] satisfies NodeOperation[];
      }
      return [];
    },
    [canManage, enforceLock, t]
  );

  const handleCollapsedChange = useCallback(
    (collapsed: boolean) => {
      if (collapsed) {
        setNewFolderId(null); // reset new folder id to clear the renaming state
        setCollapsed(true);
      } else {
        setCollapsed(false);
      }
    },
    [setCollapsed]
  );

  if (trashed) {
    return null;
  }
  if (!visible && !passthrough) {
    return null;
  }

  return (
    <>
      <NavigationPanelTreeNode
        icon={NavigationPanelFolderIcon}
        name={name}
        dndData={dndData}
        onDrop={canManage && !enforceLock ? handleDropOnFolder : undefined}
        defaultRenaming={defaultRenaming}
        renameable={canManage && !enforceLock}
        extractEmojiAsIcon={enableEmojiIcon}
        reorderable={canManage && !enforceLock && reorderable}
        collapsed={collapsed}
        setCollapsed={handleCollapsedChange}
        onRename={canManage && !enforceLock ? handleRename : undefined}
        operations={finalOperations}
        canDrop={canManage && !enforceLock ? handleCanDrop : undefined}
        childrenPlaceholder={
          <FolderEmpty
            canDrop={canManage && !enforceLock ? handleCanDrop : undefined}
            onDrop={
              canManage && !enforceLock ? handleDropOnPlaceholder : undefined
            }
          />
        }
        dropEffect={canManage && !enforceLock ? handleDropEffect : undefined}
        data-testid={`navigation-panel-folder-${node.id}`}
        explorerIconConfig={node.id ? { where: 'folder', id: node.id } : null}
      >
        {children.map(child => (
          <NavigationPanelFolderNode
            key={child.id}
            nodeId={child.id as string}
            defaultRenaming={child.id === newFolderId}
            onDrop={handleDropOnChildren}
            operations={childrenOperations}
            dropEffect={handleDropEffectOnChildren}
            canDrop={handleChildrenCanDrop}
            location={{
              at: 'navigation-panel:organize:folder-node',
              nodeId: child.id as string,
            }}
            parentPath={path}
          />
        ))}
      </NavigationPanelTreeNode>
      <FolderShareDialog
        folder={node}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </>
  );
};
