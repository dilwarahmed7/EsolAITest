import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Toast from './Toast';
import './Toast.css';

const ToastContext = createContext(null);
const DEFAULT_DURATION = 4200;

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const duration = Number.isFinite(toast.duration) ? toast.duration : DEFAULT_DURATION;
    const nextToast = {
      id,
      type: toast.type || 'info',
      title: toast.title || '',
      message: toast.message || '',
    };

    setToasts((prev) => [...prev, nextToast]);

    if (duration > 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const api = useMemo(
    () => ({
      toast: pushToast,
      success: (message, title = 'Success', options = {}) =>
        pushToast({ type: 'success', title, message, ...options }),
      error: (message, title = 'Something went wrong', options = {}) =>
        pushToast({ type: 'error', title, message, ...options }),
      info: (message, title = 'Notice', options = {}) => pushToast({ type: 'info', title, message, ...options }),
      dismiss: dismissToast,
    }),
    [pushToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onClose={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
};

export default ToastProvider;
