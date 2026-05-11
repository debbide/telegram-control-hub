import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { statsApi, DashboardStats } from "@/lib/api/backend";
import { useRealtime } from "@/hooks/useRealtime";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Bot, Zap, Brain, Rss, Bell, StickyNote, Activity, Clock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// 默认统计数据（后端未返回时使用）
const defaultStats: DashboardStats = {
  online: false,
  uptime: "-",
  memory: 0,
  lastRestart: new Date().toISOString(),
  totalCommands: 0,
  commandsToday: 0,
  aiTokensUsed: 0,
  rssFeeds: 0,
  pendingReminders: 0,
  activeNotes: 0,
  commandStats: [],
  commandTrend: [],
  recentActivity: [],
};

const DashboardSkeleton = () => (
  <div className="space-y-6 animate-fade-in">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-48 mt-2" />
      </div>
      <Skeleton className="h-8 w-28" />
    </div>

    {/* Bot Status Card */}
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-6">
          <Skeleton className="w-16 h-16 rounded-2xl" />
          <div className="flex-1 grid grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Stats Grid */}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>

    {/* Charts */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {[1, 2].map((i) => (
        <Card key={i}>
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent><Skeleton className="h-64 w-full" /></CardContent>
        </Card>
      ))}
    </div>

    {/* Bottom Cards */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {[1, 2].map((i) => (
        <Card key={i}>
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="flex items-center gap-3 p-3 rounded-xl bg-accent/30">
                <Skeleton className="w-8 h-8 rounded-lg" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  </div>
);

const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [isLoading, setIsLoading] = useState(true);
  const { addMessageHandler } = useRealtime();

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    return addMessageHandler(message => {
      if (["status", "task_update", "notification"].includes(message.type)) {
        loadStats();
      }
    });
  }, [addMessageHandler]);

  const loadStats = async () => {
    setIsLoading(true);
    const result = await statsApi.get();
    if (result.success && result.data) {
      setStats(result.data);
    }
    setIsLoading(false);
  };

  if (isLoading) {
    return <DashboardSkeleton />;
  }
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">仪表盘</h1>
          <p className="text-muted-foreground mt-1">Bot 运行状态和使用统计</p>
        </div>
        <Badge
          variant={stats.online ? "default" : "destructive"}
          className="px-3 py-1 text-sm"
        >
          <span className={`w-2 h-2 rounded-full mr-2 ${stats.online ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
          {stats.online ? "在线运行中" : "离线"}
        </Badge>
      </div>

      {/* Bot Status Card */}
      <Card className="bg-gradient-to-br from-primary/10 via-background to-accent/10 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center">
              <Bot className="w-8 h-8 text-primary" />
            </div>
            <div className="flex-1 grid grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4" /> 运行时间
                </p>
                <p className="text-lg font-semibold text-foreground mt-1">{stats.uptime}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4" /> 内存使用
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <Progress value={stats.memory} className="flex-1 h-2" />
                  <span className="text-sm font-medium text-foreground">{stats.memory}%</span>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">上次重启</p>
                <p className="text-lg font-semibold text-foreground mt-1">
                  {new Date(stats.lastRestart).toLocaleDateString("zh-CN")}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="hover:shadow-soft transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">总调用</p>
                <p className="text-xl font-bold text-foreground">{stats.totalCommands.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-soft transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
                <span className="text-lg">📈</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">今日调用</p>
                <p className="text-xl font-bold text-foreground">{stats.commandsToday}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-soft transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-secondary/20 flex items-center justify-center">
                <Brain className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">AI Tokens</p>
                <p className="text-xl font-bold text-foreground">{(stats.aiTokensUsed / 1000).toFixed(1)}k</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-soft transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center">
                <Rss className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">RSS 订阅</p>
                <p className="text-xl font-bold text-foreground">{stats.rssFeeds}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-soft transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <Bell className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">待办提醒</p>
                <p className="text-xl font-bold text-foreground">{stats.pendingReminders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-soft transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                <StickyNote className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">活动备忘</p>
                <p className="text-xl font-bold text-foreground">{stats.activeNotes}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Command Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              📈 命令使用趋势
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.commandTrend || []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary) / 0.3)"
                    name="调用次数"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Commands Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              🔥 热门命令 TOP 5
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(stats.commandStats || []).slice(0, 5)}
                  layout="vertical"
                  margin={{ left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    width={80}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '12px',
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill="hsl(var(--primary))"
                    radius={[0, 8, 8, 0]}
                    name="调用次数"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity & All Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              ⚡ 最近活动
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(stats.recentActivity || []).map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-accent/30 hover:bg-accent/50 transition-colors"
                >
                  <span className="text-xl">{activity.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{activity.description}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{activity.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* All Commands */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              📋 全部命令统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {(stats.commandStats || []).map((cmd) => (
                <div
                  key={cmd.command}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-accent/30 hover:bg-accent/50 transition-colors"
                >
                  <span className="text-lg">{cmd.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{cmd.command}</p>
                    <p className="text-sm font-semibold text-foreground">{cmd.count}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
