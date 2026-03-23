import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Settings,
  Bot,
  Key,
  Bell,
  Database,
  RefreshCw,
  Download,
  Trash2,
  Eye,
  EyeOff,
  Save,
  Power,
  Loader2,
  Cloud,
  Upload,
  FolderDown,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { settingsApi, statusApi, authApi, notificationsApi, backupApi, BotSettings, BotStatus } from "@/lib/api/backend";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SettingsPage = () => {
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Password Change State
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);


  const [isRestarting, setIsRestarting] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [config, setConfig] = useState<BotSettings>({
    botToken: "",
    adminId: "",
    groupId: "",
    tgApiBase: "https://api.telegram.org",
    webPort: 3001,
    logLevel: "info",
    autoStart: true,
    notifications: true,
    // AI 配置
    openaiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "gpt-3.5-turbo",
    github: {
      checkInterval: 10,
    },
  });

  // 加载设置
  useEffect(() => {
    loadSettings();
    loadStatus();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    const result = await settingsApi.get();
    if (result.success && result.data) {
      setConfig(prev => ({ ...prev, ...result.data }));
    }
    setIsLoading(false);
  };

  const loadStatus = async () => {
    const result = await statusApi.get();
    if (result.success && result.data) {
      setBotStatus(result.data);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    const result = await settingsApi.update(config);
    if (result.success) {
      toast.success("设置已保存");
    } else {
      toast.error(result.error || "保存失败");
    }
    setIsSaving(false);
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    const result = await statusApi.restart();
    if (result.success) {
      toast.success("Bot 正在重启...");
      // 延迟刷新状态
      setTimeout(loadStatus, 3000);
    } else {
      toast.error(result.error || "重启失败");
    }
    setIsRestarting(false);
  };

  const handleBackup = () => {
    toast.success("数据备份已开始");
  };

  const handleClearLogs = () => {
    toast.success("日志已清空");
  };

  // WebDAV 操作
  const [isTestingWebDAV, setIsTestingWebDAV] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const handleTestWebDAV = async () => {
    // 先保存配置
    await settingsApi.update(config);

    setIsTestingWebDAV(true);
    const result = await backupApi.testWebDAV();
    if (result.success) {
      toast.success(result.data?.message || "WebDAV 连接成功");
    } else {
      toast.error(result.error || "连接失败");
    }
    setIsTestingWebDAV(false);
  };

  const handleBackupToWebDAV = async () => {
    // 先保存配置
    await settingsApi.update(config);

    setIsBackingUp(true);
    const result = await backupApi.uploadToWebDAV();
    if (result.success) {
      toast.success(result.data?.message || "备份成功");
    } else {
      toast.error(result.error || "备份失败");
    }
    setIsBackingUp(false);
  };

  const handleTestNotification = async () => {
    toast.info("正在发送测试通知...");
    const result = await notificationsApi.sendTest();
    if (result.success) {
      toast.success("测试通知已发送，请检查 Telegram");
    } else {
      toast.error(result.error || "发送失败");
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      toast.error("请填写所有字段");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }

    setIsChangingPassword(true);
    const result = await authApi.changePassword(oldPassword, newPassword);
    setIsChangingPassword(false);

    if (result.success) {
      toast.success("密码修改成功");
      setIsPasswordDialogOpen(false);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      toast.error(result.error || "修改失败");
    }
  };



  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <span className="text-2xl">⚙️</span> 设置
          </h1>
          <p className="text-muted-foreground mt-1">Bot 配置和系统管理</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRestart} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            重启 Bot
          </Button>
          <Button onClick={handleSave} className="gap-2">
            <Save className="w-4 h-4" />
            保存设置
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bot Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Bot 配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="botToken">Bot Token</Label>
              <div className="flex gap-2">
                <Input
                  id="botToken"
                  type={showToken ? "text" : "password"}
                  value={config.botToken}
                  onChange={(e) => setConfig({ ...config, botToken: e.target.value })}
                  placeholder="从 @BotFather 获取"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminId">管理员 ID</Label>
              <Input
                id="adminId"
                value={config.adminId}
                onChange={(e) => setConfig({ ...config, adminId: e.target.value })}
                placeholder="你的 Telegram ID"
              />
              <p className="text-xs text-muted-foreground">用于接收 Bot 启动通知</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupId">群组 ID</Label>
              <Input
                id="groupId"
                value={config.groupId || ""}
                onChange={(e) => setConfig({ ...config, groupId: e.target.value })}
                placeholder="-1001234567890"
              />
              <p className="text-xs text-muted-foreground">RSS 推送目标群组，群组 ID 以 -100 开头</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webPort">Web 面板端口</Label>
              <Input
                id="webPort"
                type="number"
                value={config.webPort}
                onChange={(e) => setConfig({ ...config, webPort: parseInt(e.target.value) || 3000 })}
              />
            </div>
          </CardContent>
        </Card>

        {/* System Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4" />
              系统设置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label>开机自启</Label>
                <p className="text-xs text-muted-foreground">Docker 容器启动后自动运行 Bot</p>
              </div>
              <Switch
                checked={config.autoStart}
                onCheckedChange={(checked) => setConfig({ ...config, autoStart: checked })}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label>启动通知</Label>
                <p className="text-xs text-muted-foreground">Bot 启动时发送通知到管理员</p>
              </div>
              <Switch
                checked={config.notifications}
                onCheckedChange={(checked) => setConfig({ ...config, notifications: checked })}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>日志级别</Label>
              <div className="flex gap-2">
                {["debug", "info", "warn", "error"].map((level) => (
                  <Badge
                    key={level}
                    variant={config.logLevel === level ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setConfig({ ...config, logLevel: level })}
                  >
                    {level}
                  </Badge>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="githubCheckInterval">GitHub 监控间隔（分钟）</Label>
              <select
                id="githubCheckInterval"
                value={config.github?.checkInterval || 10}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    github: {
                      ...(config.github || {}),
                      checkInterval: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {[5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>{m} 分钟</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">仓库监控和账号监控共用这个检查间隔</p>
            </div>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4" />
              数据管理
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => backupApi.downloadLocal()}>
                <Download className="w-4 h-4" />
                下载本地备份
              </Button>
              <Button variant="outline" className="flex-1 gap-2 text-destructive hover:text-destructive" onClick={handleClearLogs}>
                <Trash2 className="w-4 h-4" />
                清空日志
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* WebDAV Backup */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cloud className="w-4 h-4" />
              WebDAV 云备份
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>WebDAV 地址</Label>
              <Input
                value={(config as any).webdav?.url || ""}
                onChange={(e) => setConfig({ ...config, webdav: { ...(config as any).webdav, url: e.target.value } } as any)}
                placeholder="https://dav.jianguoyun.com/dav/"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>用户名</Label>
                <Input
                  value={(config as any).webdav?.username || ""}
                  onChange={(e) => setConfig({ ...config, webdav: { ...(config as any).webdav, username: e.target.value } } as any)}
                  placeholder="邮箱或用户名"
                />
              </div>
              <div className="space-y-2">
                <Label>密码/应用密码</Label>
                <Input
                  type="password"
                  value={(config as any).webdav?.password || ""}
                  onChange={(e) => setConfig({ ...config, webdav: { ...(config as any).webdav, password: e.target.value } } as any)}
                  placeholder="应用密码"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>远程路径</Label>
              <Input
                value={(config as any).webdav?.remotePath || "/tgbot-backup"}
                onChange={(e) => setConfig({ ...config, webdav: { ...(config as any).webdav, remotePath: e.target.value } } as any)}
                placeholder="/tgbot-backup"
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/30">
              <div>
                <p className="text-sm font-medium text-foreground">自动备份</p>
                <p className="text-xs text-muted-foreground">每 24 小时自动备份，保留 3 天</p>
              </div>
              <Switch
                checked={(config as any).webdav?.autoBackup || false}
                onCheckedChange={(checked) => setConfig({ ...config, webdav: { ...(config as any).webdav, autoBackup: checked } } as any)}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={handleTestWebDAV} disabled={isTestingWebDAV}>
                {isTestingWebDAV ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                测试连接
              </Button>
              <Button className="flex-1 gap-2" onClick={handleBackupToWebDAV} disabled={isBackingUp}>
                {isBackingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                立即备份
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Power className="w-4 h-4" />
              快捷操作
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={handleRestart}>
              <RefreshCw className="w-4 h-4" />
              重启 Bot
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={handleTestNotification}>
              <Bell className="w-4 h-4" />
              发送测试通知
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setIsPasswordDialogOpen(true)}>
              <Key className="w-4 h-4" />
              修改面板密码
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Password Change Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改面板密码</DialogTitle>
            <DialogDescription>
              请输入当前密码和新密码以修改登录凭证。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>当前密码</Label>
              <Input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入当前密码"
              />
            </div>
            <div className="space-y-2">
              <Label>新密码</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入新密码"
              />
            </div>
            <div className="space-y-2">
              <Label>确认新密码</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入新密码"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>取消</Button>
            <Button onClick={handleChangePassword} disabled={isChangingPassword}>
              {isChangingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Change Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改面板密码</DialogTitle>
            <DialogDescription>
              请输入当前密码和新密码以修改登录凭证。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>当前密码</Label>
              <Input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入当前密码"
              />
            </div>
            <div className="space-y-2">
              <Label>新密码</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入新密码"
              />
            </div>
            <div className="space-y-2">
              <Label>确认新密码</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入新密码"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>取消</Button>
            <Button onClick={handleChangePassword} disabled={isChangingPassword}>
              {isChangingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Info Card */}
      <Card className="bg-gradient-to-br from-accent/50 to-background">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bot className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">TG 多功能机器人</h3>
              <p className="text-sm text-muted-foreground">版本 1.0.0 · Docker 部署</p>
            </div>
            <div className="ml-auto text-right">
              <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30">
                运行中
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
