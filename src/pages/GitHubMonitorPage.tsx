import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { githubApi, GitHubRepo, GitHubNotification, GitHubRepoInfo, GitHubOwnerMonitor } from "@/lib/api/backend";
import { Github, Plus, Trash2, RefreshCw, Star, Tag, ExternalLink, Clock, Loader2, Search, Eye, Users, GitBranch } from "lucide-react";
import { toast } from "sonner";

const GitHubSkeleton = () => (
  <div className="space-y-6 animate-fade-in">
    <div className="flex items-center justify-between">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <Skeleton className="h-10 w-32" />
    </div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  </div>
);

const GitHubMonitorPage = () => {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [owners, setOwners] = useState<GitHubOwnerMonitor[]>([]);
  const [notifications, setNotifications] = useState<GitHubNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddOwnerOpen, setIsAddOwnerOpen] = useState(false);
  const [isAddingOwner, setIsAddingOwner] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshingOwnerId, setRefreshingOwnerId] = useState<string | null>(null);

  const [repoInput, setRepoInput] = useState("");
  const [searchResult, setSearchResult] = useState<GitHubRepoInfo | null>(null);
  const [watchTypes, setWatchTypes] = useState<string[]>(["release"]);
  const [ownerInput, setOwnerInput] = useState("");
  const [ownerType, setOwnerType] = useState<"auto" | "user" | "org">("auto");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    const [reposResult, ownersResult, notificationsResult] = await Promise.all([
      githubApi.list(),
      githubApi.listOwners(),
      githubApi.getNotifications(),
    ]);
    if (reposResult.success && reposResult.data) {
      setRepos(reposResult.data);
    }
    if (ownersResult.success && ownersResult.data) {
      setOwners(ownersResult.data);
    }
    if (notificationsResult.success && notificationsResult.data) {
      setNotifications(notificationsResult.data);
    }
    setIsLoading(false);
  };

  const handleSearch = async () => {
    const match = repoInput.match(/(?:github\.com\/)?([^/]+)\/([^/\s]+)/);
    if (!match) {
      toast.error("请输入正确的仓库格式：owner/repo");
      return;
    }
    const [, owner, repo] = match;
    setIsSearching(true);
    setSearchResult(null);

    const result = await githubApi.search(owner, repo.replace(/\.git$/, ""));
    setIsSearching(false);

    if (result.success && result.data) {
      setSearchResult(result.data);
    } else {
      toast.error(result.error || "仓库不存在或无法访问");
    }
  };

  const handleAdd = async () => {
    if (!searchResult) {
      toast.error("请先搜索仓库");
      return;
    }
    if (watchTypes.length === 0) {
      toast.error("请至少选择一种监控类型");
      return;
    }

    const fullName = searchResult.fullName || searchResult.full_name || "";
    const [owner, repo] = fullName.split("/");
    setIsAdding(true);
    const result = await githubApi.create(owner, repo, watchTypes);
    setIsAdding(false);

    if (result.success) {
      toast.success("已添加监控");
      setIsAddOpen(false);
      setRepoInput("");
      setSearchResult(null);
      setWatchTypes(["release"]);
      await loadData();
    } else {
      toast.error(result.error || "添加失败");
    }
  };

  const handleDelete = async (id: string) => {
    const result = await githubApi.delete(id);
    if (result.success) {
      setRepos(repos.filter((r) => r.id !== id));
      toast.success("已取消监控");
    } else {
      toast.error(result.error || "删除失败");
    }
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    const result = await githubApi.refresh(id);
    setRefreshingId(null);
    if (result.success) {
      await loadData();
      toast.success("已刷新");
    } else {
      toast.error(result.error || "刷新失败");
    }
  };

  const handleAddOwner = async () => {
    const owner = ownerInput.trim();
    if (!owner) {
      toast.error("请输入 GitHub 账号");
      return;
    }

    setIsAddingOwner(true);
    const result = await githubApi.createOwner(owner, ownerType);
    setIsAddingOwner(false);

    if (result.success) {
      toast.success("已添加账号监控");
      setIsAddOwnerOpen(false);
      setOwnerInput("");
      setOwnerType("auto");
      await loadData();
    } else {
      toast.error(result.error || "添加失败");
    }
  };

  const handleDeleteOwner = async (id: string) => {
    const result = await githubApi.deleteOwner(id);
    if (result.success) {
      setOwners(owners.filter((o) => o.id !== id));
      toast.success("已取消账号监控");
    } else {
      toast.error(result.error || "删除失败");
    }
  };

  const handleRefreshOwner = async (id: string) => {
    setRefreshingOwnerId(id);
    const result = await githubApi.refreshOwner(id);
    setRefreshingOwnerId(null);
    if (result.success) {
      await loadData();
      toast.success("账号已刷新");
    } else {
      toast.error(result.error || "刷新失败");
    }
  };

  const handleRefreshAll = async () => {
    const result = await githubApi.refreshAll();
    if (result.success) {
      toast.success("已开始刷新所有仓库");
      setTimeout(loadData, 3000);
    } else {
      toast.error(result.error || "刷新失败");
    }
  };

  const toggleWatchType = (type: string) => {
    setWatchTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  if (isLoading) {
    return <GitHubSkeleton />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Github className="w-7 h-7" /> GitHub 监控
          </h1>
          <p className="text-muted-foreground mt-1">
            监控仓库发布/Star 里程碑，以及账号下仓库更新
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefreshAll} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            刷新全部
          </Button>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                添加监控
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>添加 GitHub 仓库监控</DialogTitle>
                <DialogDescription>
                  输入仓库地址，选择监控类型
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>仓库地址</Label>
                  <div className="flex gap-2">
                    <Input
                      value={repoInput}
                      onChange={(e) => setRepoInput(e.target.value)}
                      placeholder="owner/repo 或 GitHub URL"
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                    <Button onClick={handleSearch} disabled={isSearching}>
                      {isSearching ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {searchResult && (
                  <Card className="bg-accent/30">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <Github className="w-5 h-5" />
                        <span className="font-semibold">{searchResult.fullName || searchResult.full_name}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {searchResult.description || "无描述"}
                      </p>
                      <div className="flex gap-4 text-sm">
                        <span className="flex items-center gap-1">
                          <Star className="w-4 h-4 text-yellow-500" />
                          {(searchResult.stars || searchResult.stargazers_count || 0).toLocaleString()}
                        </span>
                        <span>{searchResult.language || "未知语言"}</span>
                        {searchResult.latestRelease && (
                          <span className="flex items-center gap-1">
                            <Tag className="w-4 h-4" />
                            {searchResult.latestRelease.tag || searchResult.latestRelease.tag_name}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-2">
                  <Label>监控类型</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={watchTypes.includes("release")}
                        onCheckedChange={() => toggleWatchType("release")}
                      />
                      <Tag className="w-4 h-4" />
                      <span className="text-sm">新版本发布</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={watchTypes.includes("star")}
                        onCheckedChange={() => toggleWatchType("star")}
                      />
                      <Star className="w-4 h-4" />
                      <span className="text-sm">Star 里程碑</span>
                    </label>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleAdd} disabled={!searchResult || isAdding}>
                  {isAdding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  添加监控
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isAddOwnerOpen} onOpenChange={setIsAddOwnerOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Users className="w-4 h-4" />
                添加账号
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>添加 GitHub 账号监控</DialogTitle>
                <DialogDescription>
                  当该账号下任意仓库有代码更新时推送提醒
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>账号</Label>
                  <Input
                    value={ownerInput}
                    onChange={(e) => setOwnerInput(e.target.value)}
                    placeholder="例如: microsoft"
                  />
                </div>
                <div className="space-y-2">
                  <Label>账号类型</Label>
                  <select
                    value={ownerType}
                    onChange={(e) => setOwnerType(e.target.value as "auto" | "user" | "org")}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="auto">自动识别</option>
                    <option value="user">用户</option>
                    <option value="org">组织</option>
                  </select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOwnerOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleAddOwner} disabled={isAddingOwner || !ownerInput.trim()}>
                  {isAddingOwner ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  添加账号监控
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="repos" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="repos" className="flex items-center gap-2">
            <Eye className="w-4 h-4" />
            监控列表 ({repos.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            通知历史 ({notifications.length})
          </TabsTrigger>
        </TabsList>

        {/* Repos Tab */}
        <TabsContent value="repos" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" /> 账号监控 ({owners.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {owners.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无账号监控，点击右上角「添加账号」即可启用。</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {owners.map((owner) => (
                    <div key={owner.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          {owner.owner}
                          <Badge variant="outline" className="text-xs">{owner.ownerType}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          上次检查：{owner.lastCheck ? new Date(owner.lastCheck).toLocaleString("zh-CN") : "从未"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRefreshOwner(owner.id)}
                          disabled={refreshingOwnerId === owner.id}
                        >
                          {refreshingOwnerId === owner.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteOwner(owner.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="mt-6">
          {repos.length === 0 ? (
            <Card className="py-12">
              <CardContent className="text-center text-muted-foreground">
                <Github className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>暂无监控仓库</p>
                <p className="text-sm mt-2">点击「添加监控」开始监控 GitHub 仓库</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {repos.map((repo) => (
                <Card key={repo.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <a
                        href={`https://github.com/${repo.fullName}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 hover:text-primary transition-colors"
                      >
                        <Github className="w-4 h-4" />
                        {repo.fullName}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </a>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      {repo.watchTypes.map((type) => (
                        <Badge key={type} variant="secondary" className="text-xs">
                          {type === "release" && <Tag className="w-3 h-3 mr-1" />}
                          {type === "star" && <Star className="w-3 h-3 mr-1" />}
                          {type === "release" ? "Release" : "Star"}
                        </Badge>
                      ))}
                    </div>

                    {repo.lastRelease && (
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Tag className="w-4 h-4" />
                        最新版本: <span className="font-mono">{repo.lastRelease.tag}</span>
                      </div>
                    )}

                    {repo.lastStar !== null && (
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Star className="w-4 h-4 text-yellow-500" />
                        Stars: {repo.lastStar?.toLocaleString()}
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      上次检查:{" "}
                      {repo.lastCheck
                        ? new Date(repo.lastCheck).toLocaleString("zh-CN")
                        : "从未"}
                    </div>

                    <div className="flex gap-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleRefresh(repo.id)}
                        disabled={refreshingId === repo.id}
                      >
                        {refreshingId === repo.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(repo.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="mt-6">
          {notifications.length === 0 ? (
            <Card className="py-12">
              <CardContent className="text-center text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>暂无通知历史</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <Card key={notification.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          notification.type === "release"
                            ? "bg-green-500/10"
                            : notification.type === "star_milestone"
                            ? "bg-yellow-500/10"
                            : "bg-blue-500/10"
                        }`}
                      >
                        {notification.type === "release" ? (
                          <Tag className="w-5 h-5 text-green-500" />
                        ) : notification.type === "star_milestone" ? (
                          <Star className="w-5 h-5 text-yellow-500" />
                        ) : (
                          <GitBranch className="w-5 h-5 text-blue-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{notification.repoFullName}</span>
                          <Badge variant="outline" className="text-xs">
                            {notification.type === "release"
                              ? "新版本"
                              : notification.type === "star_milestone"
                              ? "Star 里程碑"
                              : "账号仓库更新"}
                          </Badge>
                        </div>
                        {notification.type === "release" && notification.data.tag && (
                          <p className="text-sm mt-1">
                            发布版本{" "}
                            <span className="font-mono font-semibold">
                              {notification.data.tag}
                            </span>
                            {notification.data.name && notification.data.name !== notification.data.tag && (
                              <span className="text-muted-foreground">
                                {" "}
                                - {notification.data.name}
                              </span>
                            )}
                          </p>
                        )}
                        {notification.type === "star_milestone" && (
                          <p className="text-sm mt-1">
                            Star 突破{" "}
                            <span className="font-semibold text-yellow-600">
                              {notification.data.milestone?.toLocaleString()}
                            </span>
                            ，当前{" "}
                            <span className="font-semibold">
                              {notification.data.currentStars?.toLocaleString()}
                            </span>
                          </p>
                        )}
                        {notification.type === "owner_repo_update" && (
                          <p className="text-sm mt-1">
                            账号 <span className="font-semibold">{notification.data.owner}</span> 有
                            <span className="font-semibold text-blue-600"> {notification.data.updatedCount} </span>
                            个仓库更新
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(notification.createdAt).toLocaleString("zh-CN")}
                        </p>
                      </div>
                      {notification.data.url && (
                        <a
                          href={notification.data.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GitHubMonitorPage;
