import React from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuthenticatedImage } from '../hooks/useAuthenticatedImage';

/**
 * AuthenticatedSlipImage
 *
 * Safely fetches and renders protected images (such as payment slips)
 * using JWT Authorization headers without exposing credentials in query parameters.
 *
 * Features:
 * - Loading spinner / state during asynchronous retrieval
 * - Error card with Retry capability if unauthorized or network fails
 * - Automatic Blob URL cleanup to prevent memory leaks
 */
export default function AuthenticatedSlipImage({
  src,
  alt = 'สลิปการชำระเงิน',
  className = '',
  style = {},
  containerStyle = {},
  onClick,
  title,
  onLoad,
  fallback = null,
  showRetry = true
}) {
  const { blobUrl, loading, error, retry } = useAuthenticatedImage(src);

  if (!src || src === 'uploaded') {
    return fallback || (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          color: 'var(--text-muted, #94a3b8)',
          fontSize: '0.8rem',
          backgroundColor: 'rgba(0,0,0,0.1)',
          borderRadius: '8px',
          ...containerStyle
        }}
      >
        <span>ไม่มีรูปภาพสลิป</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: style.maxHeight || style.height || '140px',
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          borderRadius: style.borderRadius || '8px',
          border: '1px dashed var(--border-color, rgba(255,255,255,0.15))',
          padding: '20px',
          ...containerStyle
        }}
      >
        <Loader2
          size={24}
          className="animate-spin"
          style={{
            color: 'var(--primary-color, #38bdf8)',
            marginBottom: '8px'
          }}
        />
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>
          กำลังโหลดสลิป...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: style.maxHeight || style.height || '140px',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: style.borderRadius || '8px',
          padding: '16px',
          textAlign: 'center',
          ...containerStyle
        }}
      >
        <AlertCircle size={24} style={{ color: '#ef4444', marginBottom: '6px' }} />
        <span style={{ fontSize: '0.78rem', color: '#f87171', fontWeight: 600, marginBottom: '8px' }}>
          {error}
        </span>
        {showRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              retry();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255,255,255,0.08)',
              border: '1px solid var(--border-color, rgba(255,255,255,0.2))',
              color: 'var(--text-main, #f1f5f9)',
              fontSize: '0.74rem',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            <RefreshCw size={12} />
            <span>ลองใหม่</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={className}
      style={style}
      onClick={onClick}
      title={title}
      onLoad={onLoad}
    />
  );
}
