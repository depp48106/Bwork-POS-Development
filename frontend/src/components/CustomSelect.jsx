import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

function CustomSelect({ 
  value, 
  onChange, 
  options = [], 
  placeholder = 'เลือก...', 
  icon: Icon,
  style = {},
  className = '',
  disabled = false,
  menuStyle = {},
  align = 'left'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
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

  const getOptionIcon = (opt) => {
    if (typeof opt === 'object' && opt !== null && opt.icon) {
      const OptIcon = opt.icon;
      return <OptIcon size={14} style={{ color: opt.iconColor || 'var(--primary-color)', flexShrink: 0 }} />;
    }
    return null;
  };

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
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          height: '40px',
          padding: '0 12px',
          borderRadius: '12px',
          backgroundColor: 'var(--bg-color)',
          border: isOpen ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
          boxShadow: isOpen ? '0 0 0 3px rgba(37, 99, 235, 0.15)' : 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          color: 'var(--text-main)',
          fontSize: '0.82rem',
          fontWeight: 600,
          transition: 'all 0.15s ease',
          outline: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {Icon && <Icon size={15} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />}
          {selectedOption && getOptionIcon(selectedOption)}
          <span style={{ 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            color: selectedOption ? 'var(--text-main)' : 'var(--text-muted)' 
          }}>
            {getLabel(selectedOption)}
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
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
            width: '100%',
            minWidth: '100%',
            maxHeight: '260px',
            overflowY: 'auto',
            backgroundColor: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            boxShadow: '0 12px 35px rgba(0, 0, 0, 0.25)',
            zIndex: 3000,
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
                  onClick={() => {
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
                    fontSize: '0.8rem',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {getOptionIcon(opt)}
                    <span>{getLabel(opt)}</span>
                  </div>

                  {isSelected && (
                    <Check size={14} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default CustomSelect;
