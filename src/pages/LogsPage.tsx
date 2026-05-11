import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { logsApi, LogEntry } from "@/lib/api/backend";
import { useRealtime } from "@/hooks/useRealtime";
import { 
  ScrollText, 
  Search, 
  Trash2, 
  Download, 
  RefreshCw,
  Info,
  AlertTriangle,
  XCircle,
  Bug,
  Filter,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

const LogsPage = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const { isConnected, addMessageHandler } = useRealtime();

  // 加载日志
  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    return addMessageHandler(message => {
      if (message.type !== "log") return;
      const log = message.data as Partial<LogEntry> & { cleared?: boolean };
      if (log.cleared) {
        setLogs([]);
        return;
      }
      if (!log.id || !log.level || !log.message || !log.timestamp || !log.source) return;
      setLogs(prev => [log as LogEntry, ...prev.filter(item => item.id !== log.id)].slice(0, 500));
    });
  }, [addMessageHandler]);

  const loadLogs = async () => {
    setIsLoading(true);
    const result = await logsApi.get(500);
    if (result.success && result.data) {
      setLogs(result.data);
    }
    setIsLoading(false);
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           log.source.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesLevel = levelFilter === "all" || log.level === levelFilter;
      return matchesSearch && matchesLevel;
    }); // 后端已按最新在前返回
  }, [logs, searchQuery, levelFilter]);

  const handleClearLogs = async () => {
    const result = await logsApi.clear();
    if (result.success) {
      setLogs([]);
      toast.success("日志已清空");
    } else {
      toast.error(result.error || "清空失败");
    }
  };

  const handleRefresh = async () => {
    await loadLogs();
    toast.success("日志已刷新");
  };

  const handleExport = () => {
    const content = logs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`
    ).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bot-logs-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    toast.success("日志已导出");
  };

  const getLevelIcon = (level: LogEntry["level"]) => {
    switch (level) {
      case "info": return <Info className="w-4 h-4 text-blue-500" />;
      case "warn": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "error": return <XCircle className="w-4 h-4 text-red-500" />;
      case "debug": return <Bug className="w-4 h-4 text-gray-500" />;
    }
  };

  const getLevelBadge = (level: LogEntry["level"]) => {
    const styles = {
      info: "bg-blue-500/20 text-blue-600 border-blue-500/30",
      warn: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30",
      error: "bg-red-500/20 text-red-600 border-red-500/30",
      debug: "bg-gray-500/20 text-gray-600 border-gray-500/30",
    };
    return <Badge variant="outline" className={styles[level]}>{level.toUpperCase()}</Badge>;
  };

  const logCounts = useMemo(() => ({
    all: logs.length,
    info: logs.filter(l => l.level === "info").length,
    warn: logs.filter(l => l.level === "warn").length,
    error: logs.filter(l => l.level === "error").length,
    debug: logs.filter(l => l.level === "debug").length,
  }), [logs]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <span className="text-2xl">📜</span> 实时日志
          </h1>
          <p className="text-muted-foreground mt-1">查看 Bot 运行日志</p>
          <Badge variant={isConnected ? "default" : "secondary"} className="mt-2">
            {isConnected ? "实时连接" : "离线模式"}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />
            导出
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleClearLogs} 
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            清空
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索日志..."
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex gap-2">
              {(["all", "info", "warn", "error", "debug"] as const).map((level) => (
                <Button
                  key={level}
                  variant={levelFilter === level ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLevelFilter(level)}
                  className="gap-1"
                >
                  {level === "all" ? <Filter className="w-3 h-3" /> : getLevelIcon(level as LogEntry["level"])}
                  {level === "all" ? "全部" : level.toUpperCase()}
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {logCounts[level]}
                  </Badge>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="w-4 h-4" />
            日志记录 ({filteredLogs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ScrollText className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>暂无日志</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-2 font-mono text-sm">
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                      log.level === "error" 
                        ? "bg-red-500/5 hover:bg-red-500/10" 
                        : log.level === "warn"
                          ? "bg-yellow-500/5 hover:bg-yellow-500/10"
                          : "bg-accent/30 hover:bg-accent/50"
                    }`}
                  >
                    {getLevelIcon(log.level)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getLevelBadge(log.level)}
                        <Badge variant="secondary" className="text-xs">
                          {log.source}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.timestamp).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <p className="text-foreground break-all">{log.message}</p>
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

export default LogsPage;
