import { LiveData, Store } from '@toeverything/infra';
import { map } from 'rxjs';

import type { AuthService } from '../../cloud';
import type { WorkspaceDBService } from '../../db';
import type { FavoriteSupportTypeUnion } from '../constant';
import { isFavoriteSupportType } from '../constant';

export interface FavoriteRecord {
  type: FavoriteSupportTypeUnion;
  id: string;
  index: string;
}

interface RawFavoriteRow {
  key: string;
  index: string;
  ownerId?: string | null;
}

export class FavoriteStore extends Store {
  constructor(
    private readonly workspaceDBService: WorkspaceDBService,
    private readonly authService?: AuthService
  ) {
    super();
  }

  // MOJO: ownerId stamped on every favourite write so the read path
  // can second-line filter even if the underlying userdata bucket
  // ever leaks across users (legacy __local__ rows, sync edge cases).
  // Records without ownerId are treated as orphaned legacy data and
  // hidden from everyone — users who care will simply re-favourite.
  private get currentUserId(): string | null {
    return this.authService?.session.account$.value?.id ?? null;
  }

  watchIsLoading() {
    return this.workspaceDBService.userdataDB$
      .map(db => LiveData.from(db.favorite.isLoading$, false))
      .flat();
  }

  watchFavorites() {
    return this.workspaceDBService.userdataDB$
      .map(db => LiveData.from(db.favorite.find$(), []))
      .flat()
      .map(raw => {
        const userId = this.currentUserId;
        return raw
          .filter(
            (row: RawFavoriteRow) => row.ownerId && row.ownerId === userId
          )
          .map(data => this.toRecord(data))
          .filter((record): record is FavoriteRecord => !!record);
      });
  }

  addFavorite(
    type: FavoriteSupportTypeUnion,
    id: string,
    index: string
  ): FavoriteRecord {
    const db = this.workspaceDBService.userdataDB$.value;
    const raw = db.favorite.create({
      key: this.encodeKey(type, id),
      index,
      ownerId: this.currentUserId ?? undefined,
    });
    return this.toRecord(raw) as FavoriteRecord;
  }

  reorderFavorite(type: FavoriteSupportTypeUnion, id: string, index: string) {
    const db = this.workspaceDBService.userdataDB$.value;
    db.favorite.update(this.encodeKey(type, id), { index });
  }

  removeFavorite(type: FavoriteSupportTypeUnion, id: string) {
    const db = this.workspaceDBService.userdataDB$.value;
    db.favorite.delete(this.encodeKey(type, id));
  }

  watchFavorite(type: FavoriteSupportTypeUnion, id: string) {
    const db = this.workspaceDBService.userdataDB$.value;
    return LiveData.from<FavoriteRecord | undefined>(
      db.favorite.get$(this.encodeKey(type, id)).pipe(
        map(data => {
          if (!data) return undefined;
          const row = data as RawFavoriteRow;
          if (!row.ownerId || row.ownerId !== this.currentUserId) {
            return undefined;
          }
          return this.toRecord(row);
        })
      ),
      null as any
    );
  }

  private toRecord(data: RawFavoriteRow): FavoriteRecord | undefined {
    const key = this.parseKey(data.key);
    if (!key) {
      return undefined;
    }
    return {
      type: key.type,
      id: key.id,
      index: data.index,
    };
  }

  /**
   * parse favorite key
   * key format: ${type}:${id}
   * type: collection | doc | tag
   * @returns null if key is invalid
   */
  private parseKey(key: string): {
    type: FavoriteSupportTypeUnion;
    id: string;
  } | null {
    const [type, id] = key.split(':');
    if (!type || !id) {
      return null;
    }
    if (!isFavoriteSupportType(type)) {
      return null;
    }
    return { type: type as FavoriteSupportTypeUnion, id };
  }

  private encodeKey(type: FavoriteSupportTypeUnion, id: string) {
    return `${type}:${id}`;
  }
}
