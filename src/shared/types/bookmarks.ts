export type BookmarkEntry = {
  id: number;
  profileId: string;
  url: string;
  title: string;
  folder: string;
  faviconUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BookmarkInput = {
  url: string;
  title: string;
  folder?: string;
  faviconUrl?: string | null;
};
