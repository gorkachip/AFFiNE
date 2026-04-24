import { toast, useConfirmModal } from '@affine/component';
import {
  createDocExplorerContext,
  DocExplorerContext,
} from '@affine/core/components/explorer/context';
import { DocsExplorer } from '@affine/core/components/explorer/docs-view/docs-list';
import { useBlockSuiteMetaHelper } from '@affine/core/components/hooks/affine/use-block-suite-meta-helper';
import { Header } from '@affine/core/components/pure/header';
import { AuthService } from '@affine/core/modules/cloud';
import { CollectionRulesService } from '@affine/core/modules/collection-rules';
import { DocsService } from '@affine/core/modules/doc';
import { GlobalContextService } from '@affine/core/modules/global-context';
import {
  type FolderNode,
  OrganizeService,
} from '@affine/core/modules/organize';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { useI18n } from '@affine/i18n';
import { DeleteIcon, FolderIcon, ResetIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useIsActiveView,
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '../../../modules/workbench';
import { EmptyPageList } from './page-list-empty';
import * as styles from './trash-page.css';

const TrashHeader = () => {
  const t = useI18n();
  return (
    <Header
      left={
        <div className={styles.trashTitle}>
          <DeleteIcon className={styles.trashIcon} />
          {t['com.affine.workspaceSubPath.trash']()}
        </div>
      }
    />
  );
};

export const TrashPage = () => {
  const t = useI18n();
  const collectionRulesService = useService(CollectionRulesService);
  const globalContextService = useService(GlobalContextService);
  const permissionService = useService(WorkspacePermissionService);

  const { restoreFromTrash, permanentlyDeletePage } = useBlockSuiteMetaHelper();
  const isActiveView = useIsActiveView();
  const { openConfirmModal } = useConfirmModal();

  const [explorerContextValue] = useState(() =>
    createDocExplorerContext({
      displayProperties: [
        'system:createdAt',
        'system:updatedAt',
        'system:tags',
      ],
      showMoreOperation: false,
      showDragHandle: true,
      showDocPreview: false,
      quickFavorite: false,
      quickDeletePermanently: true,
      quickRestore: true,
      quickSelect: true,
      groupBy: undefined,
      orderBy: undefined,
    })
  );

  const isAdmin = useLiveData(permissionService.permission.isAdmin$);
  const isOwner = useLiveData(permissionService.permission.isOwner$);
  // MOJO: filter the Trash view so collaborators only see docs they
  // trashed themselves; owners/admins keep seeing the full workspace
  // trash.
  const authService = useService(AuthService);
  const docsService = useService(DocsService);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const groups = useLiveData(explorerContextValue.groups$);
  const isEmpty =
    groups.length === 0 ||
    (groups.length > 0 && groups.every(group => !group.items?.length));

  const handleMultiRestore = useCallback(
    (ids: string[]) => {
      ids.forEach(id => {
        restoreFromTrash(id);
      });
      toast(
        t['com.affine.toastMessage.restored']({
          title: ids.length > 1 ? 'docs' : 'doc',
        })
      );
    },
    [restoreFromTrash, t]
  );

  const handleMultiDelete = useCallback(
    (ids: string[]) => {
      ids.forEach(pageId => {
        permanentlyDeletePage(pageId);
      });
      toast(t['com.affine.toastMessage.permanentlyDeleted']());
    },
    [permanentlyDeletePage, t]
  );

  const onConfirmPermanentlyDelete = useCallback(
    (
      ids: string[],
      callbacks?: {
        onFinished?: () => void;
        onAbort?: () => void;
      }
    ) => {
      if (ids.length === 0) {
        return;
      }
      openConfirmModal({
        title: `${t['com.affine.trashOperation.deletePermanently']()}?`,
        description: t['com.affine.trashOperation.deleteDescription'](),
        cancelText: t['Cancel'](),
        confirmText: t['com.affine.trashOperation.delete'](),
        confirmButtonOptions: {
          variant: 'error',
        },
        onConfirm: () => {
          handleMultiDelete(ids);
          callbacks?.onFinished?.();
        },
        onCancel: () => {
          callbacks?.onAbort?.();
        },
      });
    },
    [handleMultiDelete, openConfirmModal, t]
  );

  useEffect(() => {
    const subscription = collectionRulesService
      .watch({
        filters: [
          {
            type: 'system',
            key: 'trash',
            method: 'is',
            value: 'true',
          },
        ],
        orderBy: {
          type: 'system',
          key: 'updatedAt',
          desc: true,
        },
      })
      .subscribe(result => {
        // MOJO: scope non-admins to items they trashed themselves.
        if (isAdmin || isOwner || !currentUserId) {
          explorerContextValue.groups$.next(result.groups);
          return;
        }
        const filtered = result.groups
          .map(group => ({
            ...group,
            items: group.items?.filter(docId => {
              const record = docsService.list.doc$(docId).value;
              const props = record?.properties$.value as
                | { trashedBy?: string | null | undefined }
                | undefined;
              return props?.trashedBy === currentUserId;
            }),
          }))
          .filter(group => group.items && group.items.length > 0);
        explorerContextValue.groups$.next(filtered);
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [
    collectionRulesService,
    explorerContextValue.groups$,
    isAdmin,
    isOwner,
    currentUserId,
    docsService,
  ]);

  useEffect(() => {
    if (isActiveView) {
      globalContextService.globalContext.isTrash.set(true);

      return () => {
        globalContextService.globalContext.isTrash.set(false);
      };
    }
    return;
  }, [globalContextService.globalContext.isTrash, isActiveView]);

  // MOJO: also surface trashed folders alongside the docs trash. Each
  // user sees their own; admins/owners see them all.
  const organizeService = useService(OrganizeService);
  const allTrashedFolders = useLiveData(
    organizeService.folderTree.trashedFolders$
  );
  const trashedFolders = useMemo(() => {
    if (isAdmin || isOwner) return allTrashedFolders;
    if (!currentUserId) return [];
    return allTrashedFolders.filter(f => f.trashedBy$.value === currentUserId);
  }, [allTrashedFolders, isAdmin, isOwner, currentUserId]);

  const showFoldersSection = trashedFolders.length > 0;

  return (
    <DocExplorerContext.Provider value={explorerContextValue}>
      <ViewTitle title={t['Trash']()} />
      <ViewIcon icon={'trash'} />
      <ViewHeader>
        <TrashHeader />
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          {showFoldersSection && (
            <TrashedFoldersSection
              folders={trashedFolders}
              canPermaDelete={isAdmin || isOwner}
            />
          )}
          {isEmpty && !showFoldersSection ? (
            <EmptyPageList type="trash" />
          ) : (
            <DocsExplorer
              disableMultiDelete={!isAdmin && !isOwner}
              onRestore={isAdmin || isOwner ? handleMultiRestore : undefined}
              onDelete={
                isAdmin || isOwner ? onConfirmPermanentlyDelete : undefined
              }
            />
          )}
        </div>
      </ViewBody>
    </DocExplorerContext.Provider>
  );
};

// MOJO: per-user (or per-admin) list of soft-deleted folders. Each row
// has Restore + Delete forever (admins only).
const TrashedFoldersSection = ({
  folders,
  canPermaDelete,
}: {
  folders: FolderNode[];
  canPermaDelete: boolean;
}) => {
  return (
    <div className={styles.trashedFoldersSection}>
      <div className={styles.trashedFoldersHeader}>Folders in trash</div>
      <ul className={styles.trashedFoldersList}>
        {folders.map(folder => (
          <TrashedFolderRow
            key={folder.id ?? ''}
            folder={folder}
            canPermaDelete={canPermaDelete}
          />
        ))}
      </ul>
    </div>
  );
};

const TrashedFolderRow = ({
  folder,
  canPermaDelete,
}: {
  folder: FolderNode;
  canPermaDelete: boolean;
}) => {
  const name = useLiveData(folder.name$);
  const trashedAt = useLiveData(folder.trashedAt$);
  return (
    <li className={styles.trashedFolderRow}>
      <FolderIcon className={styles.trashedFolderIcon} />
      <span className={styles.trashedFolderName}>{name || 'Untitled'}</span>
      {trashedAt && (
        <span className={styles.trashedFolderTime}>
          {new Date(trashedAt).toLocaleString()}
        </span>
      )}
      <button
        className={styles.trashedFolderAction}
        onClick={() => folder.restoreFromTrash()}
        title="Restore"
      >
        <ResetIcon /> Restore
      </button>
      {canPermaDelete && (
        <button
          className={styles.trashedFolderActionDanger}
          onClick={() => folder.permanentlyDelete()}
          title="Delete forever"
        >
          <DeleteIcon /> Delete forever
        </button>
      )}
    </li>
  );
};

export const Component = () => {
  return <TrashPage />;
};
