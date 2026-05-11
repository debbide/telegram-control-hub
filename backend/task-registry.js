const { EventEmitter } = require('events');

class TaskRegistry extends EventEmitter {
  constructor({ maxRecentRuns = 20 } = {}) {
    super();
    this.tasks = new Map();
    this.maxRecentRuns = maxRecentRuns;
  }

  upsertTask(id, updates) {
    const existing = this.tasks.get(id) || {
      id,
      type: 'system',
      name: id,
      description: '',
      interval: '',
      lastRun: null,
      nextRun: null,
      status: 'active',
      error: null,
      lastDurationMs: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      recentRuns: [],
    };

    const task = { ...existing, ...updates, id };
    this.tasks.set(id, task);
    this.emit('task:update', task);
    return task;
  }

  markRunStart(id, updates = {}) {
    return this.upsertTask(id, {
      ...updates,
      lastRun: updates.startedAt || new Date().toISOString(),
      status: 'running',
      error: null,
    });
  }

  markRunSuccess(id, { startedAt, finishedAt = new Date().toISOString(), nextRun = null, updates = {} } = {}) {
    const task = this.tasks.get(id) || { id, recentRuns: [] };
    const durationMs = startedAt ? new Date(finishedAt).getTime() - new Date(startedAt).getTime() : null;
    const recentRuns = [
      {
        startedAt: startedAt || finishedAt,
        finishedAt,
        durationMs,
        status: 'success',
      },
      ...(task.recentRuns || []),
    ].slice(0, this.maxRecentRuns);

    return this.upsertTask(id, {
      ...updates,
      status: 'active',
      error: null,
      nextRun,
      lastDurationMs: durationMs,
      lastSuccessAt: finishedAt,
      runCount: (task.runCount || 0) + 1,
      successCount: (task.successCount || 0) + 1,
      recentRuns,
    });
  }

  markRunError(id, error, { startedAt, finishedAt = new Date().toISOString(), nextRun = null, updates = {} } = {}) {
    const task = this.tasks.get(id) || { id, recentRuns: [] };
    const message = error?.message || String(error);
    const durationMs = startedAt ? new Date(finishedAt).getTime() - new Date(startedAt).getTime() : null;
    const recentRuns = [
      {
        startedAt: startedAt || finishedAt,
        finishedAt,
        durationMs,
        status: 'error',
        error: message,
      },
      ...(task.recentRuns || []),
    ].slice(0, this.maxRecentRuns);

    return this.upsertTask(id, {
      ...updates,
      status: 'error',
      error: message,
      nextRun,
      lastDurationMs: durationMs,
      lastErrorAt: finishedAt,
      runCount: (task.runCount || 0) + 1,
      failureCount: (task.failureCount || 0) + 1,
      recentRuns,
    });
  }

  removeTask(id) {
    const existed = this.tasks.delete(id);
    if (existed) {
      this.emit('task:remove', { id });
    }
    return existed;
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  listTasks() {
    return Array.from(this.tasks.values());
  }

  getRecentRuns(id) {
    return this.getTask(id)?.recentRuns || [];
  }
}

module.exports = TaskRegistry;
