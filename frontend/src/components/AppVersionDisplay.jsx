import React, { useState, useEffect } from 'react';
import { X, Megaphone, CheckCircle2, ChevronRight, Info } from 'lucide-react';
import { APP_INFO, RELEASE_NOTES } from '../versionConfig';

function AppVersionDisplay({ isOpen: externalIsOpen, setIsOpen: externalSetIsOpen }) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const setIsOpen = externalSetIsOpen || setInternalIsOpen;

  // Close modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            zIndex: 12000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setIsOpen(false)}
        >
          <div 
            className="card"
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '86vh',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
              overflow: 'hidden',
              animation: 'modalSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 22px',
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'rgba(255, 255, 255, 0.02)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(37, 99, 235, 0.12)',
                  color: 'var(--primary-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Megaphone size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    ประกาศระบบ / บันทึกการปรับปรุง (Patch Notes)
                  </h3>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {APP_INFO.name} v{APP_INFO.version} · {APP_INFO.developer}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '6px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.15s'
                }}
                title="ปิดหน้าต่าง"
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: Scrollable Release Notes List */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px'
            }}>
              {RELEASE_NOTES.map((note) => (
                <div 
                  key={note.version}
                  style={{
                    borderRadius: '12px',
                    border: note.isLatest ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
                    backgroundColor: note.isLatest ? 'rgba(37, 99, 235, 0.03)' : 'rgba(255, 255, 255, 0.01)',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  {/* Version Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        color: note.isLatest ? 'var(--primary-color)' : 'var(--text-main)',
                        fontFamily: 'monospace'
                      }}>
                        v{note.version}
                      </span>
                      {note.isLatest && (
                        <span style={{
                          padding: '1px 8px',
                          borderRadius: '999px',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          backgroundColor: '#10b981',
                          color: '#ffffff'
                        }}>
                          เวอร์ชันปัจจุบัน
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      วันที่: {note.date}
                    </div>
                  </div>

                  {/* Patch Title */}
                  {note.title && (
                    <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {note.title}
                    </div>
                  )}

                  {/* Highlights List */}
                  <ul style={{
                    margin: 0,
                    paddingLeft: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '0.8rem',
                    color: 'var(--text-main)',
                    lineHeight: 1.45
                  }}>
                    {note.highlights.map((item, idx) => (
                      <li key={idx} style={{ color: 'var(--text-main)' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* System Metadata Box (Safe Public Metadata) */}
              <div style={{
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-hover)',
                padding: '12px 16px',
                fontSize: '0.74rem',
                color: 'var(--text-muted)',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '8px',
                marginTop: '4px'
              }}>
                <div>
                  <span style={{ fontWeight: 600 }}>ระบบ:</span>{' '}
                  <strong style={{ color: 'var(--text-main)' }}>{APP_INFO.name}</strong>
                </div>
                <div>
                  <span style={{ fontWeight: 600 }}>เวอร์ชัน:</span>{' '}
                  <strong style={{ color: 'var(--text-main)' }}>v{APP_INFO.version}</strong>
                </div>
                <div>
                  <span style={{ fontWeight: 600 }}>วันที่สร้าง Build:</span>{' '}
                  <strong style={{ color: 'var(--text-main)' }}>{APP_INFO.buildDate}</strong>
                </div>
                <div>
                  <span style={{ fontWeight: 600 }}>ผู้พัฒนา:</span>{' '}
                  <strong style={{ color: 'var(--text-main)' }}>{APP_INFO.developer}</strong>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '12px 22px',
              borderTop: '1px solid var(--border-color)',
              backgroundColor: 'rgba(255, 255, 255, 0.02)'
            }}>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="btn btn-secondary"
                style={{
                  padding: '7px 20px',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  fontWeight: 600
                }}
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
  );
}

export default AppVersionDisplay;
