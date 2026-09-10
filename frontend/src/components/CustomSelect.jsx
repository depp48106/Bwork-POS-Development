import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

function CustomSelect({ 
  value, 
  onChange, 
  options = [], 
  placeholder = 'เลือก...', 
  icon: Icon,
  style = {},
  triggerStyle = {},
  className = '',
  disabled = false,
  menuStyle = {},
  align = 'left',
  size = 'medium',
  wrap = false,
  usePortal = false,
  noTruncate = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const popoverRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        containerRef.current && 
        !containerRef.current.contains(event.target) &&
        (!popoverRef.current || !popoverRef.current.contains(event.target))
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, right: 0, minWidth: 0 });

  const updatePopoverPos = useCallback(() => {
    if (usePortal && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const rightDistance = window.innerWidth - rect.right;
      setPopoverPos({
        top: rect.bottom + 6,
        left: rect.left,
        right: rightDistance,
        minWidth: rect.width
      });
    }
  }, [usePortal]);

  useEffect(() => {
    if (isOpen && usePortal) {
      updatePopoverPos();
      window.addEventListener('resize', updatePopoverPos);
      window.addEventListener('scroll', updatePopoverPos, true);
      return () => {
        window.removeEventListener('resize', updatePopoverPos);
        window.removeEventListener('scroll', updatePopoverPos, true);
      };
    }
  }, [isOpen, usePortal, updatePopoverPos]);

  const selectedOption = options.find(opt => {
    if (typeof opt === 'object' && opt !== null) {
      return String(opt.value) === String(value);
    }
    return String(opt) === String(value);
  });

  const getLabel = (opt) => {
    if (!opt) return placeholder;
    if (typeof opt === 'object' && opt !== null) {
      return opt.label || opt.name || opt.value;
    }
    return opt;
  };

  const getTriggerLabel = (opt) => {
    if (!opt) return placeholder;
    if (typeof opt === 'object' && opt !== null) {
      return opt.triggerLabel || opt.label || opt.name || opt.value;
    }
    return opt;
  };

  const getOptionIcon = (opt) => {
    if (typeof opt === 'object' && opt !== null && opt.icon) {
      const OptIcon = opt.icon;
      return <OptIcon size={14} style={{ color: opt.iconColor || 'var(--primary-color)', flexShrink: 0 }} />;
    }
    return null;
  };

  const isSmall = size === 'small';
  const shouldWrap = wrap || triggerStyle.whiteSpace === 'normal';

  return (
    <div 
      ref={containerRef} 
      className={`custom-select-container ${className}`}
      style={{ 
        position: 'relative', 
        width: '100%',
        userSelect: 'none',
        ...style 
      }}
    >
      {/* Trigger Button */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setIsOpen(prev => !prev);
          }
        }}
        title={selectedOption ? String(getLabel(selectedOption)) : ''}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: isSmall ? '6px' : '8px',
          height: shouldWrap ? 'auto' : (isSmall ? '32px' : '40px'),
          minHeight: isSmall ? '32px' : '40px',
          padding: isSmall ? '4px 8px' : '0 12px',
          borderRadius: isSmall ? '8px' : '12px',
          backgroundColor: 'var(--bg-color)',
          border: isOpen ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
          boxShadow: isOpen ? '0 0 0 3px rgba(37, 99, 235, 0.15)' : 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          color: 'var(--text-main)',
          fontSize: isSmall ? '0.75rem' : '0.82rem',
          fontWeight: 600,
          transition: 'all 0.15s ease',
          outline: 'none',
          boxSizing: 'border-box',
          ...triggerStyle
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          overflow: noTruncate ? 'visible' : (shouldWrap ? 'visible' : 'hidden'), 
          textOverflow: noTruncate ? 'clip' : (shouldWrap ? 'clip' : 'ellipsis'), 
          whiteSpace: shouldWrap ? 'normal' : 'nowrap', 
          flex: 1, 
          minWidth: 0,
          textAlign: 'left'
        }}>
          {Icon && <Icon size={15} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />}
          {selectedOption && getOptionIcon(selectedOption)}
          <span style={{ 
            overflow: noTruncate ? 'visible' : (shouldWrap ? 'visible' : 'hidden'), 
            textOverflow: noTruncate ? 'clip' : (shouldWrap ? 'clip' : 'ellipsis'), 
            whiteSpace: shouldWrap ? 'normal' : 'nowrap',
            wordBreak: shouldWrap ? 'break-word' : 'normal',
            lineHeight: shouldWrap ? 1.35 : 1,
            color: selectedOption ? 'var(--text-main)' : 'var(--text-muted)' 
          }}>
            {getTriggerLabel(selectedOption)}
          </span>
        </div>

        <ChevronDown 
          size={15} 
          style={{ 
            color: 'var(--text-muted)', 
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }} 
        />
      </div>

      {/* Popover Dropdown Menu */}
      {isOpen && (() => {
        const menuNode = (
          <>
            {usePortal && (
              <div 
                onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998 }}
              />
            )}
            <div
              ref={popoverRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: usePortal ? 'fixed' : 'absolute',
                top: usePortal ? `${popoverPos.top}px` : 'calc(100% + 6px)',
                ...(usePortal
                  ? (align === 'right' ? { right: `${Math.max(10, popoverPos.right)}px` } : { left: `${Math.max(10, popoverPos.left)}px` })
                  : (align === 'right' ? { right: 0 } : { left: 0 })
                ),
                width: 'max-content',
                minWidth: usePortal ? `${Math.max(popoverPos.minWidth, 140)}px` : '100%',
                maxWidth: '380px',
                maxHeight: '280px',
                overflowY: 'auto',
                backgroundColor: 'var(--bg-card)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid var(--border-color)',
                borderRadius: '14px',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
                zIndex: 99999,
                padding: '5px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                boxSizing: 'border-box',
                animation: 'fadeIn 0.15s ease-out',
                ...menuStyle
              }}
              className="scrollbar-thin"
            >
              {options.length === 0 ? (
                <div style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  ไม่มีตัวเลือก
                </div>
              ) : (
                options.map((opt, idx) => {
                  const optVal = typeof opt === 'object' && opt !== null ? opt.value : opt;
                  const isSelected = String(optVal) === String(value);

                  return (
                    <div
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('[CustomSelect] Option clicked:', optVal);
                        onChange(optVal);
                        setIsOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '9px',
                        fontSize: '0.84rem',
                        fontWeight: isSelected ? 800 : 500,
                        color: isSelected ? 'var(--primary-color)' : 'var(--text-main)',
                        backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        overflow: noTruncate ? 'visible' : 'hidden', 
                        whiteSpace: shouldWrap ? 'normal' : 'nowrap',
                        wordBreak: shouldWrap ? 'break-word' : 'normal',
                        lineHeight: shouldWrap ? 1.35 : 1,
                        flex: 1 
                      }}>
                        {getOptionIcon(opt)}
                        <span style={{ whiteSpace: shouldWrap ? 'normal' : 'nowrap' }}>{getLabel(opt)}</span>
                      </div>

                      {isSelected && (
                        <Check size={14} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        );

        return usePortal && typeof document !== 'undefined'
          ? createPortal(menuNode, document.body)
          : menuNode;
      })()}
    </div>
  );
}

export default CustomSelect;
