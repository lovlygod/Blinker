import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Eye, EyeOff, KeyRound, Loader2, Plus, Search, Trash2, Clipboard, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WebsiteFavicon } from "@/components/main/website-favicon";
import type { Profile } from "~/flow/interfaces/sessions/profiles";
import type { PasswordEntry, PasswordEntryInput } from "~/types/passwords";

const emptyDraft: PasswordEntryInput = {
  url: "",
  username: "",
  password: "",
  title: "",
  note: ""
};

function AddPasswordDialog({
  open,
  onOpenChange,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (entry: PasswordEntryInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PasswordEntryInput>(emptyDraft);
  const [isSaving, setIsSaving] = useState(false);

  const updateDraft = (key: keyof PasswordEntryInput, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!draft.url.trim() || !draft.username.trim() || !draft.password) {
      toast.error("Заполните сайт, логин и пароль.");
      return;
    }

    setIsSaving(true);
    try {
      await onSave(draft);
      setDraft(emptyDraft);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Добавить пароль</DialogTitle>
          <DialogDescription>Сохраните учетные данные в локальном хранилище Blinker.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="password-url">Сайт</Label>
            <Input
              id="password-url"
              value={draft.url}
              onChange={(event) => updateDraft("url", event.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password-username">Логин</Label>
            <Input
              id="password-username"
              value={draft.username}
              onChange={(event) => updateDraft("username", event.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password-value">Пароль</Label>
            <Input
              id="password-value"
              type="password"
              value={draft.password}
              onChange={(event) => updateDraft("password", event.target.value)}
              placeholder="Введите пароль"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password-title">Название</Label>
            <Input
              id="password-title"
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
              placeholder="Необязательно"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password-note">Заметка</Label>
            <textarea
              id="password-note"
              value={draft.note ?? ""}
              onChange={(event) => updateDraft("note", event.target.value)}
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-20 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              placeholder="Необязательно"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function passwordHost(entry: PasswordEntry): string {
  try {
    return new URL(entry.url).hostname;
  } catch {
    return entry.origin;
  }
}

export function PasswordsSettings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [query, setQuery] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Set<number>>(new Set());
  const [copiedPasswordId, setCopiedPasswordId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const loadProfiles = useCallback(async () => {
    const [allProfiles, currentProfileId] = await Promise.all([
      flow.profiles.getProfiles(),
      flow.profiles.getUsingProfile()
    ]);
    const userProfiles = allProfiles.filter((profile) => !profile.internal);
    setProfiles(userProfiles);
    setProfileId(currentProfileId ?? userProfiles[0]?.id ?? null);
  }, []);

  const loadPasswords = useCallback(async () => {
    if (!profileId) {
      setEntries([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      setEntries(await flow.passwords.list(profileId));
    } catch (error) {
      console.error("Failed to load passwords:", error);
      toast.error("Не удалось загрузить пароли.");
    } finally {
      setIsLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    loadProfiles().catch((error) => {
      console.error("Failed to load profiles:", error);
      toast.error("Не удалось загрузить профили.");
      setIsLoading(false);
    });
  }, [loadProfiles]);

  useEffect(() => {
    loadPasswords();
  }, [loadPasswords]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.url, entry.username, entry.source].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      )
    );
  }, [entries, query]);

  const handleSave = async (entry: PasswordEntryInput) => {
    if (!profileId) return;
    await flow.passwords.save(profileId, entry);
    toast.success("Пароль сохранен.");
    await loadPasswords();
  };

  const handleExport = async () => {
    if (!profileId) return;
    setIsExporting(true);
    try {
      const exported = await flow.passwords.exportToCsv(profileId);
      if (exported) toast.success("CSV с паролями экспортирован.");
    } catch (error) {
      console.error("Failed to export passwords:", error);
      toast.error("Не удалось экспортировать CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!profileId) return;
    const deleted = await flow.passwords.delete(profileId, id);
    if (deleted) {
      toast.success("Пароль удален.");
      await loadPasswords();
    } else {
      toast.error("Не удалось удалить пароль.");
    }
  };

  const copyUsername = (username: string) => {
    flow.app.writeTextToClipboard(username);
    toast.success("Логин скопирован.");
  };

  const copyPassword = (id: number, password: string) => {
    flow.app.writeTextToClipboard(password);
    setCopiedPasswordId(id);
    window.setTimeout(() => {
      setCopiedPasswordId((current) => (current === id ? null : current));
    }, 1300);
    toast.success("Пароль скопирован.");
  };

  const togglePassword = (id: number) => {
    setVisiblePasswords((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6 remove-app-drag">
      <div>
        <h2 className="text-2xl font-semibold text-card-foreground">Пароли</h2>
        <p className="text-muted-foreground">Локальный менеджер паролей и импорт из популярных браузеров.</p>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <KeyRound className="h-5 w-5" />
                Хранилище паролей
              </CardTitle>
              <CardDescription>
                Поддерживаются CSV-экспорты Chrome, Edge, Brave, Vivaldi, Opera, Firefox, Safari, Bitwarden, 1Password,
                LastPass и Dashlane.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleExport} disabled={!profileId || isExporting}>
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Экспорт CSV
              </Button>
              <Button onClick={() => setAddOpen(true)} disabled={!profileId}>
                <Plus className="h-4 w-4" />
                Добавить
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="password-profile">Профиль</Label>
              <Select value={profileId ?? ""} onValueChange={setProfileId}>
                <SelectTrigger id="password-profile" className="w-full">
                  <SelectValue placeholder="Выберите профиль" />
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
            <div className="space-y-2">
              <Label htmlFor="password-search">Поиск</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                  placeholder="Сайт, логин или источник"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Загружаю пароли...</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <KeyRound className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium text-card-foreground">
                {query ? "Ничего не найдено" : "В этом профиле пока нет паролей"}
              </p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Добавьте запись вручную или импортируйте данные в разделе «Импорт данных».
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сайт</TableHead>
                  <TableHead>Логин</TableHead>
                  <TableHead>Пароль</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead className="w-32 text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => {
                  const isVisible = visiblePasswords.has(entry.id);
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="max-w-[280px]">
                        <div className="flex items-center gap-3">
                          <WebsiteFavicon url={entry.url} className="h-5 w-5 shrink-0" />
                          <div className="min-w-0">
                            <p className="truncate font-medium" title={entry.title || entry.url}>
                              {entry.title || passwordHost(entry)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground" title={entry.url}>
                              {passwordHost(entry)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <button
                          className="block max-w-full truncate text-left hover:underline"
                          title="Скопировать логин"
                          onClick={() => copyUsername(entry.username)}
                        >
                          {entry.username}
                        </button>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{isVisible ? entry.password : "••••••••••••"}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{entry.source}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => togglePassword(entry.id)} title="Показать">
                            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyPassword(entry.id, entry.password)}
                            title="Скопировать"
                          >
                            {copiedPasswordId === entry.id ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Clipboard className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(entry.id)}
                            title="Удалить"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddPasswordDialog open={addOpen} onOpenChange={setAddOpen} onSave={handleSave} />
    </div>
  );
}
