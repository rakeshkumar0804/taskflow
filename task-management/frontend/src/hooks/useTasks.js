import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { useSocket } from '../context/SocketContext';
import toast from 'react-hot-toast';

export const useTasks = (filters = {}) => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const socket = useSocket();

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v)
      );
      const { data } = await api.get('/tasks', { params });
      setTasks(data.tasks);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]); // eslint-disable-line

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Real-time updates
  useEffect(() => {
    if (!socket) return;

    const onCreated = (task) => setTasks((prev) => [task, ...prev]);
    const onUpdated = (task) =>
      setTasks((prev) => prev.map((t) => (t._id === task._id ? task : t)));
    const onDeleted = ({ _id }) =>
      setTasks((prev) => prev.filter((t) => t._id !== _id));

    socket.on('task:created', onCreated);
    socket.on('task:updated', onUpdated);
    socket.on('task:deleted', onDeleted);

    return () => {
      socket.off('task:created', onCreated);
      socket.off('task:updated', onUpdated);
      socket.off('task:deleted', onDeleted);
    };
  }, [socket]);

  const createTask = async (taskData) => {
    const { data } = await api.post('/tasks', taskData);
    return data.task;
  };

  const updateTask = async (id, taskData) => {
    const { data } = await api.put(`/tasks/${id}`, taskData);
    return data.task;
  };

  const deleteTask = async (id) => {
    await api.delete(`/tasks/${id}`);
  };

  const addComment = async (id, text) => {
    const { data } = await api.post(`/tasks/${id}/comments`, { text });
    return data.comments;
  };

  return { tasks, loading, fetchTasks, createTask, updateTask, deleteTask, addComment };
};
