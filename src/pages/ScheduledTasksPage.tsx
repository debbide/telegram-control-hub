import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { scheduledTasksApi, ScheduledTask } from "@/lib/api/backend";
import { useRealtime } from "@/hooks/useRealtime";
import {
  Clock,
  RefreshCw,
  Rss,
  Bell,
  Cloud,
  CheckCircle,
  AlertCircle,
  PauseCircle,
  Loader2,
  Timer,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

const ScheduledTasksPage = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isConnected, addMessageHandler } = useRealtime();

  useEffect(() => {
    loadTasks();
    // 每 30 秒自动刷新
    const interval = setInterval(loadTasks, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return addMessageHandler(message => {
      if (message.type !== "task_update") return;
      const task = message.data as ScheduledTask & { removed?: boolean };
      setTasks(prev => {
        if (task.removed) {
          return prev.filter(item => item.id !== task.id);
        }
        const exists = prev.some(item => item.id === task.id);
        if (!exists) return [task, ...prev];
        return prev.map(item => item.id === task.id ? { ...item, ...task } : item);
      });
    });
  }, [addMessageHandler]);

  const loadTasks = async () => {
    const result = await scheduledTasksApi.list();
    if (result.success && result.data) {
      setTasks(result.data);
    }
    setIsLoading(false);
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    await loadTasks();
    toast.success("已刷新任务状态");
  };

  const getTypeIcon = (type: ScheduledTask["type"]) => {
    switch (type) {
      case "rss":
        return <Rss className="w-5 h-5 text-orange-500" />;
      case "system":
        return <Bell className="w-5 h-5 text-blue-500" />;
      case "backup":
        return <Cloud className="w-5 h-5 text-green-500" />;
      default:
        return <Clock className="w-5 h-5" />;
    }
  };

  const getStatusBadge = (status: ScheduledTask["status"]) => {
    switch (status) {
      case "running":
        return (
          <Badge variant="default" className="bg-blue-500/20 text-blue-600 border-blue-500/30">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            执行中
          </Badge>
        );
      case "active":
        return (
          <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30">
            <CheckCircle className="w-3 h-3 mr-1" />
            运行中
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="bg-red-500/20 text-red-600 border-red-500/30">
            <AlertCircle className="w-3 h-3 mr-1" />
            异常
          </Badge>
        );
      case "paused":
        return (
          <Badge variant="secondary">
            <PauseCircle className="w-3 h-3 mr-1" />
            已暂停
          </Badge>
        );
    }
  };

  const getTypeBadge = (type: ScheduledTask["type"]) => {
    switch (type) {
      case "rss":
        return <Badge variant="outline" className="bg-orange-500/10 text-orange-600">RSS</Badge>;
      case "system":
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600">系统</Badge>;
      case "backup":
        return <Badge variant="outline" className="bg-green-500/10 text-green-600">备份</Badge>;
    }
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTimeUntilNext = (nextRun: string | null) => {
    if (!nextRun) return null;
    const now = new Date();
    const next = new Date(nextRun);
    const diff = next.getTime() - now.getTime();

    if (diff < 0) return "即将执行";

    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes} 分钟后`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时后`;

    const days = Math.floor(hours / 24);
    return `${days} 天后`;
  };

  // 统计
  const activeCount = tasks.filter(t => t.status === "active").length;
  const errorCount = tasks.filter(t => t.status === "error").length;
  const rssCount = tasks.filter(t => t.type === "rss").length;

  if (isLoading && tasks.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-56 mt-2" />
          </div>
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 p-4 border-b">
                <Skeleton className="w-10 h-10 rounded-xl" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-48 mb-2" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <span className="text-2xl">⏰</span> 定时任务
          </h1>
          <p className="text-muted-foreground mt-1">查看和管理后台定时任务</p>
          <Badge variant={isConnected ? "default" : "secondary"} className="mt-2">
            {isConnected ? "实时连接" : "轮询模式"}
          </Badge>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isLoading} className="gap-2">
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          刷新
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCount}</p>
                <p className="text-sm text-muted-foreground">运行中任务</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <Rss className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{rssCount}</p>
                <p className="text-sm text-muted-foreground">RSS 订阅任务</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${errorCount > 0 ? 'bg-red-500/10' : 'bg-muted'}`}>
                <AlertCircle className={`w-6 h-6 ${errorCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{errorCount}</p>
                <p className="text-sm text-muted-foreground">异常任务</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Task List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="w-4 h-4" />
            任务列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>暂无定时任务</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3 pr-4">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`p-4 rounded-lg border transition-colors ${
                      task.status === "error" ? "border-red-500/30 bg-red-500/5" : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        {getTypeIcon(task.type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-medium">{task.name}</h3>
                          {getTypeBadge(task.type)}
                          {getStatusBadge(task.status)}
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{task.description}</p>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            间隔: {task.interval}
                          </span>
                          {task.lastRun && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              上次: {formatTime(task.lastRun)}
                            </span>
                          )}
                          {task.nextRun && (
                            <span className="flex items-center gap-1 text-primary">
                              <Timer className="w-3 h-3" />
                              {getTimeUntilNext(task.nextRun)}
                            </span>
                          )}
                        </div>

                        {task.error && (
                          <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {task.error}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ScheduledTasksPage;
