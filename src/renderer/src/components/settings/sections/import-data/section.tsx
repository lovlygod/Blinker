import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Bookmark, CircleHelp, Download, FolderInput, KeyRound, Puzzle, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/lib/i18n";
import type { Profile } from "~/flow/interfaces/sessions/profiles";

type ImportItem = {
  id: "passwords" | "bookmarks" | "extensions";
  title: string;
  description: string;
  helpTitle: string;
  help: string[];
  icon: ReactNode;
  ready: boolean;
};

function getImportItems(): ImportItem[] {
  return [
    {
      id: "passwords",
      title: t("import.passwords"),
      description: t("import.passwordsDescription"),
      helpTitle: "Где взять CSV с паролями",
      help: [
        "Chrome: chrome://password-manager/settings -> Экспорт паролей.",
        "Edge: edge://wallet/passwords или edge://settings/passwords -> экспорт паролей.",
        "Brave: brave://password-manager/settings -> Экспорт паролей.",
        "Firefox: about:logins -> меню с тремя точками -> Экспорт логинов.",
        "Safari: Settings -> Passwords -> меню действий -> Export.",
        "Bitwarden, 1Password, LastPass, Dashlane: Export vault / Export -> CSV."
      ],
      icon: <KeyRound className="h-5 w-5" />,
      ready: true
    },
    {
      id: "bookmarks",
      title: t("import.bookmarks"),
      description: t("import.bookmarksDescription"),
      helpTitle: "Как подготовить закладки",
      help: [
        "Chrome/Edge/Brave: Bookmark Manager -> меню -> Export bookmarks.",
        "Firefox: Library -> Bookmarks -> Manage bookmarks -> Import and Backup -> Export Bookmarks to HTML.",
        "Safari: File -> Export -> Bookmarks.",
        "Импорт HTML-закладок пока оставлен как следующий шаг: экран уже готов, backend ещё нужно добавить."
      ],
      icon: <Bookmark className="h-5 w-5" />,
      ready: false
    },
    {
      id: "extensions",
      title: t("import.extensions"),
      description: t("import.extensionsDescription"),
      helpTitle: "Как импортировать расширение",
      help: [
        "Выберите папку unpacked-расширения, в которой лежит manifest.json.",
        "Для своих расширений это обычно папка проекта расширения или распакованный архив.",
        "Chrome Web Store не даёт безопасно скопировать установленные расширения напрямую: лучше скачать исходную unpacked-папку или установить расширение заново."
      ],
      icon: <Puzzle className="h-5 w-5" />,
      ready: true
    }
  ];
}

function ImportHelp({ item }: { item: ImportItem }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" title="Справка по импорту">
            <CircleHelp className="h-4 w-4" />
          </Button>
        }
      />
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-4">
        <PopoverTitle className="mb-3 text-sm font-semibold">{item.helpTitle}</PopoverTitle>
        <div className="space-y-2 text-sm text-muted-foreground">
          {item.help.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ImportDataSettings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isImportingPasswords, setIsImportingPasswords] = useState(false);
  const [isImportingExtensions, setIsImportingExtensions] = useState(false);
  const importItems = getImportItems();

  const loadProfiles = useCallback(async () => {
    const [allProfiles, currentProfileId] = await Promise.all([
      flow.profiles.getProfiles(),
      flow.profiles.getUsingProfile()
    ]);
    const userProfiles = allProfiles.filter((profile) => !profile.internal);
    setProfiles(userProfiles);
    setProfileId(currentProfileId ?? userProfiles[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const importPasswords = async () => {
    if (!profileId) return;
    setIsImportingPasswords(true);
    try {
      const result = await flow.passwords.importFromCsv(profileId);
      if (!result) return;
      toast.success(`Пароли: ${result.imported} новых, ${result.updated} обновлено, ${result.skipped} пропущено.`);
    } catch (error) {
      console.error("Failed to import passwords:", error);
      toast.error("Не удалось импортировать пароли.");
    } finally {
      setIsImportingPasswords(false);
    }
  };

  const importExtensions = async () => {
    setIsImportingExtensions(true);
    try {
      const extension = await flow.extensions.importUnpacked();
      if (!extension) return;
      toast.success(`Расширение импортировано: ${extension.name}`);
    } catch (error) {
      console.error("Failed to import extension:", error);
      toast.error("Не удалось импортировать расширение.");
    } finally {
      setIsImportingExtensions(false);
    }
  };

  return (
    <div className="space-y-6 remove-app-drag">
      <div>
        <h2 className="text-2xl font-semibold text-card-foreground">{t("import.title")}</h2>
        <p className="text-muted-foreground">{t("import.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {importItems.map((item) => (
          <Card key={item.id} className="gap-4">
            <CardHeader className="pb-0">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  {item.icon}
                  {item.title}
                </CardTitle>
                <ImportHelp item={item} />
              </div>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {item.id === "passwords" ? (
                <Button onClick={importPasswords} disabled={!profileId || isImportingPasswords}>
                  <Download className="h-4 w-4" />
                  {t("import.importCsv")}
                </Button>
              ) : item.id === "extensions" ? (
                <Button onClick={importExtensions} disabled={isImportingExtensions}>
                  <FolderInput className="h-4 w-4" />
                  {t("import.importFolder")}
                </Button>
              ) : (
                <Button variant="outline" disabled={!item.ready}>
                  <Settings2 className="h-4 w-4" />
                  {t("import.soon")}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {profiles.length === 0 && <p className="text-sm text-muted-foreground">{t("import.noProfiles")}</p>}
    </div>
  );
}
