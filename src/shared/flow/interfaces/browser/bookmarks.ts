import type { BookmarkEntry, BookmarkInput } from "~/types/bookmarks";

export interface FlowBookmarksAPI {
  list: () => Promise<BookmarkEntry[]>;
  getForUrl: (url: string) => Promise<BookmarkEntry | null>;
  save: (bookmark: BookmarkInput) => Promise<BookmarkEntry>;
  delete: (id: number) => Promise<boolean>;
  deleteForUrl: (url: string) => Promise<boolean>;
  importFromHtml: () => Promise<number | null>;
  exportToHtml: () => Promise<boolean>;
}
