import { useThemeColorV2, Wrapper } from '@affine/component';
import { EmptyDocs } from '@affine/core/components/affine/empty';
import {
  createDocExplorerContext,
  DocExplorerContext,
} from '@affine/core/components/explorer/context';
import { DocsExplorer } from '@affine/core/components/explorer/docs-view/docs-list';
import { AuthService } from '@affine/core/modules/cloud';
import { CollectionRulesService } from '@affine/core/modules/collection-rules';
import type { FilterParams } from '@affine/core/modules/collection-rules/types';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo, useState } from 'react';

import { Page } from '../../components/page';
import { AllDocsHeader } from '../../views';

const AllDocs = () => {
  const [explorerContextValue] = useState(() =>
    createDocExplorerContext({
      quickFavorite: false,
      showDocIcon: false,
      displayProperties: [
        'system:createdAt',
        'system:updatedAt',
        'system:tags',
      ],
      view: 'masonry',
      showDragHandle: false,
      groupBy: undefined,
      orderBy: undefined,
    })
  );
  const collectionRulesService = useService(CollectionRulesService);
  // MOJO: same scoping as the desktop All Docs page — admin/owner sees
  // every doc, members only see what they created.
  const authService = useService(AuthService);
  const permissionService = useService(WorkspacePermissionService);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const isOwnerOrAdmin = useLiveData(
    permissionService.permission.isOwnerOrAdmin$
  );
  const visibilityExtraFilters = useMemo<FilterParams[]>(() => {
    const base: FilterParams[] = [
      { type: 'system', key: 'trash', method: 'is', value: 'false' },
      {
        type: 'system',
        key: 'empty-journal',
        method: 'is',
        value: 'false',
      },
    ];
    if (isOwnerOrAdmin) return base;
    if (!currentUserId) {
      return [
        ...base,
        {
          type: 'system',
          key: 'createdBy',
          method: 'include',
          value: '__no_user__',
        },
      ];
    }
    return [
      ...base,
      {
        type: 'system',
        key: 'createdBy',
        method: 'include',
        value: currentUserId,
      },
    ];
  }, [currentUserId, isOwnerOrAdmin]);
  const groups = useLiveData(explorerContextValue.groups$);
  const isEmpty =
    groups.length === 0 ||
    (groups.length && groups.every(group => !group.items.length));

  useEffect(() => {
    const subscription = collectionRulesService
      .watch({
        filters: [
          { type: 'system', key: 'trash', method: 'is', value: 'false' },
        ],
        extraFilters: visibilityExtraFilters,
        orderBy: {
          type: 'system',
          key: 'updatedAt',
          desc: true,
        },
      })
      .subscribe({
        next: result => {
          explorerContextValue.groups$.next(result.groups);
        },
        error: console.error,
      });
    return () => subscription.unsubscribe();
  }, [
    collectionRulesService,
    explorerContextValue.groups$,
    visibilityExtraFilters,
  ]);

  if (isEmpty) {
    return (
      <>
        <EmptyDocs absoluteCenter />
        <Wrapper height={0} flexGrow={1} />
      </>
    );
  }

  return (
    <DocExplorerContext.Provider value={explorerContextValue}>
      <DocsExplorer masonryItemWidthMin={150} />
    </DocExplorerContext.Provider>
  );
};

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');

  return (
    <Page header={<AllDocsHeader />} tab>
      <AllDocs />
    </Page>
  );
};
