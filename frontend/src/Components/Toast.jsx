import React from 'react';
import Icon from './Icons';

function Toast({ toast, onClose }) {
  const { id, type = 'info', title, message } = toast;

  const iconByType = {
    success: <Icon.CheckCircle className="toast-icon" />,
    error: <Icon.AlertCircle className="toast-icon" />,
    info: <Icon.Info className="toast-icon" />,
  };

  return (
    <div className={`toast toast-${type}`} role="status" aria-live="polite">
      <div className="toast-content">
        <span className="toast-icon-wrap">{iconByType[type] || iconByType.info}</span>
        <div className="toast-text">
          {title ? <p className="toast-title">{title}</p> : null}
          {message ? <p className="toast-message">{message}</p> : null}
        </div>
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => onClose(id)}>
        <Icon.X className="toast-close-icon" />
      </button>
    </div>
  );
}

export default Toast;
