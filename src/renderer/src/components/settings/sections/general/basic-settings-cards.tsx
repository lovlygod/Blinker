import { useSettings } from "@/components/providers/settings-provider";
import { BasicSetting, BasicSettingCard } from "~/types/settings";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ResetOnboardingCard } from "@/components/settings/sections/general/reset-onboarding-card";
import { UpdateCard } from "@/components/settings/sections/general/update-card";
import { SetAsDefaultBrowserSetting } from "@/components/settings/sections/general/set-as-default-browser-setting";
import { TooltipProvider } from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { FolderOpen, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

const cardTranslationKeys: Record<string, { title: string; subtitle: string }> = {
  "autoUpdate,syncTabsAcrossWindows,appLanguage,defaultSearchEngine,downloadDirectory,contentBlocker,internal_setAsDefaultBrowser":
    {
      title: "card.general.title",
      subtitle: "card.general.subtitle"
    },
  newTabMode: {
    title: "card.newTab.title",
    subtitle: "card.newTab.subtitle"
  },
  commandPaletteOpacity: {
    title: "card.commandPalette.title",
    subtitle: "card.commandPalette.subtitle"
  },
  sidebarSide: {
    title: "card.sidebar.title",
    subtitle: "card.sidebar.subtitle"
  },
  "archiveTabAfter,sleepTabAfter": {
    title: "card.performance.title",
    subtitle: "card.performance.subtitle"
  },
  enableFlowPdfViewer: {
    title: "card.experimental.title",
    subtitle: "card.experimental.subtitle"
  },
  enableMv2Extensions: {
    title: "card.advanced.title",
    subtitle: "card.advanced.subtitle"
  }
};

function getSettingLabel(setting: BasicSetting) {
  return t(`setting.${setting.id}`);
}

function getOptionLabel(optionId: string, fallback: string) {
  return t(`setting.option.${optionId}`) || fallback;
}

function getCardLabels(card: BasicSettingCard) {
  const keys = cardTranslationKeys[card.settings.join(",")];
  if (!keys) {
    return { title: card.title, subtitle: card.subtitle };
  }

  return { title: t(keys.title), subtitle: t(keys.subtitle) };
}

function DownloadDirectoryInput() {
  const [directory, setDirectory] = useState("");

  const refresh = async () => {
    setDirectory(await flow.downloads.getDownloadDirectory());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const choose = async () => {
    const selected = await flow.downloads.chooseDownloadDirectory();
    if (selected) setDirectory(selected);
  };

  const reset = async () => {
    setDirectory(await flow.downloads.resetDownloadDirectory());
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="max-w-[260px] truncate text-xs text-muted-foreground">{directory}</span>
      <Button variant="outline" size="sm" onClick={() => void choose()} className="gap-2">
        <FolderOpen className="size-3.5" />
        {t("setting.chooseDownloadFolder")}
      </Button>
      <Button variant="ghost" size="icon" onClick={() => void reset()} aria-label={t("setting.resetDownloadFolder")}>
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  );
}

export function SettingsInput({ setting }: { setting: BasicSetting }) {
  const { getSetting, setSetting } = useSettings();

  const handleSettingChange = (value: BasicSetting["defaultValue"]) => {
    setSetting(setting.id, value);
  };

  if (setting.id === "downloadDirectory") {
    return <DownloadDirectoryInput />;
  }

  if (setting.type === "enum") {
    const settingValue = getSetting<string>(setting.id);
    return (
      <div className={cn(setting.showName === false ? "w-full" : "w-auto")}>
        <Select value={settingValue} onValueChange={handleSettingChange}>
          <SelectTrigger className="w-full min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="remove-app-drag z-popover">
            {setting.options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {getOptionLabel(option.id, option.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  } else if (setting.type === "boolean") {
    const settingValue = getSetting<boolean>(setting.id);
    return <Switch checked={settingValue} onCheckedChange={handleSettingChange} />;
  }

  return null;
}

export function BasicSettingsCard({ card, transparent }: { card: BasicSettingCard; transparent?: boolean }) {
  const { settings } = useSettings();
  const cardLabels = getCardLabels(card);

  if (card.title === "INTERNAL_UPDATE") {
    return <UpdateCard />;
  } else if (card.title === "INTERNAL_ONBOARDING") {
    return <ResetOnboardingCard />;
  }

  return (
    <TooltipProvider>
      <div className={cn("remove-app-drag rounded-lg border p-6", transparent ? "bg-muted/30" : "bg-card")}>
        <div className="mb-4">
          <h3 className="text-xl font-semibold tracking-tight text-card-foreground">{cardLabels.title}</h3>
          {cardLabels.subtitle && <p className="text-sm text-muted-foreground mt-1">{cardLabels.subtitle}</p>}
        </div>
        <div className="space-y-4">
          {card.settings.map((settingId) => {
            if (settingId === "internal_setAsDefaultBrowser") {
              return <SetAsDefaultBrowserSetting key={settingId} />;
            }

            const setting = settings.find((s) => s.id === settingId);
            if (!setting) return null;

            const settingDescription = (setting as BasicSetting & { description?: string }).description || null;

            return (
              <div
                key={setting.id}
                className="flex flex-row items-center justify-between gap-4 p-3 rounded-md hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 space-y-0.5">
                  <Label htmlFor={setting.id} className="text-sm font-medium">
                    {getSettingLabel(setting)}
                  </Label>
                  {setting.showName !== false && settingDescription && (
                    <p className="text-xs text-muted-foreground">{settingDescription}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <SettingsInput setting={setting} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

export function BasicSettingsCards() {
  const { cards } = useSettings();

  return (
    <div className="space-y-6">
      {cards.map((card, index) => (
        <BasicSettingsCard key={index} card={card} />
      ))}
    </div>
  );
}
