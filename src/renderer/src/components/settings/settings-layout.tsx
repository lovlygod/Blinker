import { useEffect, useState, useMemo } from "react";
import { SettingsSidebar } from "./settings-sidebar";
import { GeneralSettings } from "@/components/settings/sections/general/section";
import { IconSettings } from "@/components/settings/sections/icon/section";
import { AboutSettings } from "@/components/settings/sections/about/section";
import { ProfilesSettings } from "@/components/settings/sections/profiles/section";
import { SpacesSettings } from "@/components/settings/sections/spaces/section";
import { ExternalAppsSettings } from "@/components/settings/sections/external-apps/section";
import { ShortcutsSettings } from "@/components/settings/sections/shortcuts/section";
import { PasswordsSettings } from "@/components/settings/sections/passwords/section";
import { ImportDataSettings } from "@/components/settings/sections/import-data/section";
import { PermissionsSettings } from "@/components/settings/sections/permissions/section";
import { SettingsProvider } from "@/components/providers/settings-provider";
import { AppUpdatesProvider } from "@/components/providers/app-updates-provider";
import {
  Globe,
  DockIcon,
  UsersIcon,
  OrbitIcon,
  BlocksIcon,
  Info,
  KeyboardIcon,
  KeyRound,
  Import,
  ShieldCheck
} from "lucide-react";
import { ShortcutsProvider } from "@/components/providers/shortcuts-provider";
import { LANGUAGE_CHANGED_EVENT, t } from "@/lib/i18n";

export function SettingsLayout() {
  const [activeSection, setActiveSection] = useState(() => window.location.hash.replace("#", "") || "general");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [languageRevision, setLanguageRevision] = useState(0);

  useEffect(() => {
    const handleLanguageChanged = () => setLanguageRevision((revision) => revision + 1);
    window.addEventListener(LANGUAGE_CHANGED_EVENT, handleLanguageChanged);
    return () => window.removeEventListener(LANGUAGE_CHANGED_EVENT, handleLanguageChanged);
  }, []);

  const sections = [
    { id: "general", label: t("settings.general"), icon: <Globe className="h-4 w-4 mr-2" /> },
    { id: "import-data", label: t("settings.importData"), icon: <Import className="h-4 w-4 mr-2" /> },
    { id: "passwords", label: t("settings.passwords"), icon: <KeyRound className="h-4 w-4 mr-2" /> },
    { id: "permissions", label: "Разрешения", icon: <ShieldCheck className="h-4 w-4 mr-2" /> },
    { id: "icons", label: t("settings.icon"), icon: <DockIcon className="h-4 w-4 mr-2" /> },
    { id: "profiles", label: t("settings.profiles"), icon: <UsersIcon className="h-4 w-4 mr-2" /> },
    { id: "spaces", label: t("settings.spaces"), icon: <OrbitIcon className="h-4 w-4 mr-2" /> },
    { id: "external-apps", label: t("settings.externalApps"), icon: <BlocksIcon className="h-4 w-4 mr-2" /> },
    { id: "shortcuts", label: t("settings.shortcuts"), icon: <KeyboardIcon className="h-4 w-4 mr-2" /> },
    { id: "about", label: t("settings.about"), icon: <Info className="h-4 w-4 mr-2" /> }
  ];

  const navigateToSpaces = (profileId: string) => {
    setSelectedProfileId(profileId);
    setSelectedSpaceId(null);
    setActiveSection("spaces");
  };

  const navigateToSpace = (profileId: string, spaceId: string) => {
    setSelectedProfileId(profileId);
    setSelectedSpaceId(spaceId);
    setActiveSection("spaces");
  };

  const ActiveSectionComponent = useMemo(() => {
    switch (activeSection) {
      case "general":
        return <GeneralSettings />;
      case "passwords":
        return <PasswordsSettings />;
      case "permissions":
        return <PermissionsSettings />;
      case "import-data":
        return <ImportDataSettings />;
      case "icons":
        return <IconSettings />;
      case "about":
        return <AboutSettings />;
      case "profiles":
        return <ProfilesSettings navigateToSpaces={navigateToSpaces} navigateToSpace={navigateToSpace} />;
      case "spaces":
        return <SpacesSettings initialSelectedProfile={selectedProfileId} initialSelectedSpace={selectedSpaceId} />;
      case "external-apps":
        return <ExternalAppsSettings />;
      case "shortcuts":
        return <ShortcutsSettings />;
      default:
        return <GeneralSettings />;
    }
  }, [activeSection, selectedProfileId, selectedSpaceId, languageRevision]);

  return (
    <AppUpdatesProvider>
      <ShortcutsProvider>
        <SettingsProvider>
          <div className="select-none flex flex-col h-screen bg-background text-gray-600 dark:text-gray-300">
            <title>{t("settings.title")}</title>
            <div className="flex flex-1 overflow-hidden">
              <SettingsSidebar activeSection={activeSection} setActiveSection={setActiveSection} sections={sections} />
              <main className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-auto p-6 md:p-8">
                  <div className="mx-auto max-w-4xl">{ActiveSectionComponent}</div>
                </div>
              </main>
            </div>
          </div>
        </SettingsProvider>
      </ShortcutsProvider>
    </AppUpdatesProvider>
  );
}
