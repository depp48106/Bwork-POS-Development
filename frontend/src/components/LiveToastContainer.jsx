import React from 'react';
import { Bell, FileText, Clock, AlertCircle, X, ChevronRight } from 'lucide-react';

export default function LiveToastContainer({ toasts = [], onDismiss, onToastClick }) {
  if (!toasts || toasts.length === 0) return null;

  const getEventMeta = (eventType) => {
    switch (eventType) {
      case 'NEW_LINE_BOOKING':
        return {
          icon: <Bell size={18} style={{ color: '#2563eb' }} />,
          accentColor: '#2563eb',
          iconBg: 'rgba(37, 99, 235, 0.08)'
        };
      case 'SLIP_UPLOADED':
        return {
          icon: <FileText size={18} style={{ color: '#0ea5e9' }} />,
          accentColor: '#0ea5e9',
          iconBg: 'rgba(14, 165, 233, 0.08)'
        };
      case 'ROOM_UPCOMING':
        return {
          icon: <Clock size={18} style={{ color: '#f59e0b' }} />,
          accentColor: '#f59e0b',
          iconBg: 'rgba(245, 158, 11, 0.08)'
        };
      case 'ROOM_STARTED':
        return {
          icon: <AlertCircle size={18} style={{ color: '#ef4444' }} />,
          accentColor: '#ef4444',
          iconBg: 'rgba(239, 68, 68, 0.08)'
        };
      default:
        return {
          icon: <Bell size={18} style={{ color: 'var(--text-main)' }} />,
          accentColor: 'var(--border-color)',
          iconBg: 'rgba(0, 0, 0, 0.05)'
        };
    }
  };

  return (
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'fixed',
        top: '74px',
        right: '20px',
        zIndex: 11000,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '380px',
        width: 'calc(100% - 40px)',
        pointerEvents: 'none'
      }}
    >
      {toasts.map((toast) => {
        const meta = getEventMeta(toast.eventType);

        return (
          <div
            key={toast.id}
            onClick={() => onToastClick && onToastClick(toast)}
            style={{
              pointerEvents: 'auto',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderLeft: `4px solid ${meta.accentColor}`,
              borderRadius: '12px',
              padding: '12px 14px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              cursor: 'pointer',
              animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.16)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';
            }}
          >
            {/* Functional Icon */}
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: meta.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '2px'
              }}
            >
              {meta.icon}
            </div>

            {/* Content Body */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: 'var(--text-main)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>{toast.title}</span>
              </div>

              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  lineHeight: '1.35',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-line'
                }}
              >
                {toast.message}
              </div>

              {toast.actionLabel && (
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: meta.accentColor,
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                >
                  <span>{toast.actionLabel}</span>
                  <ChevronRight size={12} />
                </div>
              )}
            </div>

            {/* Dismiss Close Button */}
            <button
              type="button"
              aria-label="ปิดการแจ้งเตือน"
              onClick={(e) => {
                e.stopPropagation();
                if (onDismiss) onDismiss(toast.id);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '-2px',
                marginRight: '-4px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.06)';
                e.currentTarget.style.color = 'var(--text-main)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
