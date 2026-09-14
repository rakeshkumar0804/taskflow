/**
 * taskHelpers.js
 * Shared task calculation contracts for TasksPage and ProjectDetailPage.
 */

export const COLUMNS = [
  { key: 'To Do', label: 'To Do', icon: '○' },
  { key: 'In Progress', label: 'In Progress', icon: '◉' },
  { key: 'Done', label: 'Done', icon: '✓' },
];

export const getDueDateInfo = (dueDate, status) => {
  if (!dueDate) return { label: 'No due date', isOverdue: false, isToday: false };
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return { label: 'No due date', isOverdue: false, isToday: false };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59, 999);

  const formatted = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (status !== 'Done' && d < startOfToday) {
    return { label: 'Overdue', isOverdue: true, isToday: false };
  }
  if (status !== 'Done' && d >= startOfToday && d <= endOfToday) {
    return { label: 'Due today', isOverdue: false, isToday: true };
  }
  if (status !== 'Done' && d > endOfToday && d <= tomorrowEnd) {
    return { label: 'Due tomorrow', isOverdue: false, isToday: false };
  }
  return { label: formatted, isOverdue: false, isToday: false };
};

export const isTaskInMyFocus = (task, currentUser) => {
  if (!task || task.status === 'Done') return false;
  if (!currentUser) return false;
  const currentUserId = (currentUser._id || currentUser.id)?.toString();
  if (!currentUserId) return false;

  const assignedId = task.assignedTo?._id
    ? task.assignedTo._id.toString()
    : task.assignedTo
    ? task.assignedTo.toString()
    : null;

  return Boolean(assignedId && assignedId === currentUserId);
};

export const getPrimaryRiskReason = (task) => {
  if (!task || task.status === 'Done') return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

  if (task.dueDate) {
    const d = new Date(task.dueDate);
    if (!isNaN(d.getTime()) && d < startOfToday) {
      return 'Overdue';
    }
  }

  if (task.dueDate) {
    const d = new Date(task.dueDate);
    if (!isNaN(d.getTime()) && d >= startOfToday && d <= in48Hours) {
      return 'Due within 48 hours';
    }
  }

  if (task.status === 'In Progress' && task.updatedAt) {
    const updated = new Date(task.updatedAt);
    if (!isNaN(updated.getTime()) && updated <= fourDaysAgo) {
      return 'Stalled in progress (4+ days)';
    }
  }

  if ((task.priority === 'critical' || task.priority === 'high') && task.status === 'To Do') {
    return 'High priority not started';
  }

  return null;
};

export const isTaskAtRisk = (task) => Boolean(getPrimaryRiskReason(task));

export const formatRelativeTime = (dateString) => {
  if (!dateString) return 'Recently';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'Recently';
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
