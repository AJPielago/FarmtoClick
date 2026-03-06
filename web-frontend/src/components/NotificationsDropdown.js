import React, { useEffect, useState, forwardRef } from 'react';
import { notificationsAPI } from '../services/api';

const NotificationsDropdown = forwardRef(({ visible, onClose }, ref) => {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    notificationsAPI.getNotifications()
      .then(res => {
        setNotifs(res.data || []);
      })
      .catch(() => setNotifs([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const markRead = async (id) => {
    try {
      await notificationsAPI.markAsRead(id);
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      // ignore
    }
  };

  if (!visible) return null;

  return (
    <div className="notifications-panel" onClick={(e)=>e.stopPropagation()} ref={ref}>
      <div className="notifications-header">
        <strong>Notifications</strong>
        <button className="close-ctrl" onClick={onClose}>×</button>
      </div>
      <div className="notifications-list">
        {loading && <div className="notif-empty">Loading…</div>}
        {!loading && notifs.length === 0 && <div className="notif-empty">No notifications</div>}
        {!loading && notifs.map(n => (
          <div key={n.id} className={`notif-item ${n.read ? 'read' : 'unread'}`} onClick={() => markRead(n.id)}>
            <div className="notif-subject">{n.subject || 'Notification'}</div>
            <div className="notif-message">{n.message}</div>
            <div className="notif-time">{n.created_at || ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default NotificationsDropdown;
