import type { SitePermissionEntry, SitePermissionInput } from "~/types/site-permissions";

export interface FlowSitePermissionsAPI {
  list: (profileId?: string) => Promise<SitePermissionEntry[]>;
  set: (profileId: string, input: SitePermissionInput) => Promise<SitePermissionEntry>;
  remove: (profileId: string, id: number) => Promise<boolean>;
  clear: (profileId: string) => Promise<void>;
}
