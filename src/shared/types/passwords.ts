export type PasswordEntry = {
  id: number;
  profileId: string;
  origin: string;
  url: string;
  username: string;
  password: string;
  title: string;
  note: string | null;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export type PasswordEntryInput = {
  url: string;
  username: string;
  password: string;
  title?: string;
  note?: string | null;
  source?: string;
};

export type PasswordAutofillEntry = {
  id: number;
  username: string;
  password: string;
  title: string;
  origin: string;
};

export type PasswordSaveCandidate = {
  url: string;
  username: string;
  password: string;
  title?: string;
  isUpdate?: boolean;
};

export type PasswordImportResult = {
  imported: number;
  skipped: number;
  updated: number;
  source: string;
  fileName: string | null;
};
