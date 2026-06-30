import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { t } from "@/lib/i18n";
import type { Profile } from "~/flow/interfaces/sessions/profiles";
import type { SitePermissionEntry, SitePermissionSetting } from "~/types/site-permissions";

const permissionLabelKeys: Record<string, string> = {
  media: "permission.cameraMicrophoneTitle",
  geolocation: "permission.geolocationTitle",
  notifications: "permission.notificationsTitle",
  midiSysex: "permission.midiSysexTitle",
  pointerLock: "permission.pointerLockTitle",
  fullscreen: "permission.fullscreenTitle"
};

function labelForPermission(permission: string) {
  return t(permissionLabelKeys[permission] ?? permission);
}

function labelForSetting(setting: SitePermissionSetting) {
  if (setting === "allow") return t("permissions.allow");
  if (setting === "block") return t("permissions.block");
  return t("permissions.ask");
}

export function PermissionsSettings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [permissions, setPermissions] = useState<SitePermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadProfiles() {
      const [allProfiles, currentProfileId] = await Promise.all([
        flow.profiles.getProfiles(),
        flow.profiles.getUsingProfile()
      ]);
      if (cancelled) return;
      setProfiles(allProfiles);
      setProfileId(currentProfileId ?? allProfiles[0]?.id ?? "");
    }
    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPermissions() {
      if (!profileId) {
        setPermissions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const list = await flow.sitePermissions.list(profileId);
      if (!cancelled) {
        setPermissions(list);
        setLoading(false);
      }
    }
    void loadPermissions();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const grouped = useMemo(() => {
    const map = new Map<string, SitePermissionEntry[]>();
    for (const permission of permissions) {
      map.set(permission.origin, [...(map.get(permission.origin) ?? []), permission]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [permissions]);

  const updatePermission = async (entry: SitePermissionEntry, setting: SitePermissionSetting) => {
    if (!profileId) return;
    const updated = await flow.sitePermissions.set(profileId, {
      origin: entry.origin,
      permission: entry.permission,
      setting
    });
    setPermissions((current) => current.map((item) => (item.id === entry.id ? updated : item)));
  };

  const removePermission = async (entry: SitePermissionEntry) => {
    if (!profileId) return;
    const removed = await flow.sitePermissions.remove(profileId, entry.id);
    if (removed) setPermissions((current) => current.filter((item) => item.id !== entry.id));
  };

  const clearAll = async () => {
    if (!profileId) return;
    await flow.sitePermissions.clear(profileId);
    setPermissions([]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("permissions.title")}</h1>
        <p className="text-muted-foreground">{t("permissions.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ShieldCheck className="h-5 w-5" />
                {t("permissions.center")}
              </CardTitle>
              <CardDescription>{t("permissions.description")}</CardDescription>
            </div>
            <Button variant="outline" onClick={clearAll} disabled={!profileId || permissions.length === 0}>
              <Trash2 className="h-4 w-4" />
              {t("permissions.clear")}
            </Button>
          </div>

          <div className="max-w-xs space-y-2">
            <Label htmlFor="permissions-profile">{t("permissions.profile")}</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="permissions-profile" className="w-full">
                <SelectValue placeholder={t("permissions.selectProfile")} />
              </SelectTrigger>
              <SelectContent className="remove-app-drag z-popover">
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-14 text-center text-sm text-muted-foreground">{t("permissions.loading")}</div>
          ) : permissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <ShieldCheck className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium text-card-foreground">{t("permissions.empty")}</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("permissions.emptyHint")}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([origin, items]) => (
                <div key={origin} className="rounded-lg border">
                  <div className="border-b px-4 py-3 text-sm font-semibold">{origin}</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("permissions.permission")}</TableHead>
                        <TableHead className="w-48">{t("permissions.state")}</TableHead>
                        <TableHead className="w-20 text-right">{t("permissions.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{labelForPermission(entry.permission)}</TableCell>
                          <TableCell>
                            <Select
                              value={entry.setting}
                              onValueChange={(value) => void updatePermission(entry, value as SitePermissionSetting)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue>{labelForSetting(entry.setting)}</SelectValue>
                              </SelectTrigger>
                              <SelectContent className="remove-app-drag z-popover">
                                <SelectItem value="allow">{t("permissions.allow")}</SelectItem>
                                <SelectItem value="block">{t("permissions.block")}</SelectItem>
                                <SelectItem value="ask">{t("permissions.ask")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => void removePermission(entry)}
                              aria-label={t("permissions.remove")}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
