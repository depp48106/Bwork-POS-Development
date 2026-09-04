import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';

const STEPS = [
  { step: 1, label: 'วัน/เวลา', path: '/' },
  { step: 2, label: 'เลือกห้อง', path: '/rooms' },
  { step: 3, label: 'ข้อมูลผู้จอง', path: '/form' },
  { step: 4, label: 'ชำระเงิน', path: '/confirm' }
];

export default function StepProgress({ currentStep }) {
  const navigate = useNavigate();

  const handleStepClick = (item) => {
    // Allow clicking back to earlier steps if passed
    if (item.step < currentStep) {
      navigate(item.path);
    }
  };

  return (
    <div className="step-progress-container" style={{
      backgroundColor: '#ffffff',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '16px 20px',
      marginBottom: '24px',
      boxShadow: 'var(--shadow-sm)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative'
      }}>
        {/* Background Connecting Line */}
        <div
          className="step-progress-line"
          style={{
            position: 'absolute',
            height: '3px',
            backgroundColor: '#e2e8f0',
            zIndex: 1
          }}
        >
          {/* Active Filled Progress Line */}
          <div style={{
            height: '100%',
            backgroundColor: 'var(--primary)',
            width: `${((currentStep - 1) / (STEPS.length - 1)) * 100}%`,
            transition: 'width 0.3s ease'
          }} />
        </div>

        {/* Step Items */}
        {STEPS.map((item) => {
          const isCompleted = item.step < currentStep;
          const isActive = item.step === currentStep;
          const isClickable = isCompleted;

          return (
            <div
              key={item.step}
              onClick={() => isClickable && handleStepClick(item)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                zIndex: 2,
                cursor: isClickable ? 'pointer' : 'default',
                userSelect: 'none'
              }}
            >
              {/* Circle Badge */}
              <div 
                className="step-progress-badge"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  backgroundColor: isActive ? 'var(--primary)' : isCompleted ? '#10b981' : '#ffffff',
                  color: (isActive || isCompleted) ? '#ffffff' : '#94a3b8',
                  border: isActive ? '3px solid #bfdbfe' : isCompleted ? '2px solid #10b981' : '2px solid #cbd5e1',
                  boxShadow: isActive ? '0 0 12px rgba(37, 99, 235, 0.4)' : 'none',
                  transition: 'all 0.25s ease'
                }}
              >
                {isCompleted ? <Check size={18} strokeWidth={3} /> : item.step}
              </div>

              {/* Label */}
              <span 
                className="step-progress-label"
                style={{
                  fontSize: '0.78rem',
                  fontWeight: isActive ? 800 : isCompleted ? 700 : 500,
                  color: isActive ? 'var(--primary)' : isCompleted ? '#0f172a' : '#94a3b8',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.2s ease'
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
