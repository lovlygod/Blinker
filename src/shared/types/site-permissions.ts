export type SitePermissionSetting = "allow" | "block" | "ask";

export type SitePermissionEntry = {
  id: number;
  profileId: string;
  origin: string;
  permission: string;
  setting: SitePermissionSetting;
  updatedAt: number;
};

export type SitePermissionInput = {
  origin: string;
  permission: string;
  setting: SitePermissionSetting;
};
