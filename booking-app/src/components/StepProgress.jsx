import React from 'react';

export default function StepProgress({ currentStep }) {
  const steps = [
    { num: 1, label: 'วัน/เวลา' },
    { num: 2, label: 'เลือกห้อง' },
    { num: 3, label: 'กรอกข้อมูล' },
    { num: 4, label: 'ชำระเงิน' }
  ];

  return (
    <div style={{ maxWidth: '380px', margin: '0 auto 1.25rem auto', padding: '0 0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        
        {/* Background Connecting Line */}
        <div style={{
          position: 'absolute',
          top: '14px',
          left: '16px',
          right: '16px',
          height: '2px',
          backgroundColor: '#cbd5e1',
          zIndex: 1
        }}></div>

        {/* Active Line Fill */}
        <div style={{
          position: 'absolute',
          top: '14px',
          left: '16px',
          width: currentStep === 1 ? '0%' : currentStep === 2 ? '33%' : currentStep === 3 ? '66%' : '100%',
          height: '2px',
          backgroundColor: 'var(--primary)',
          transition: 'width 0.3s ease',
          zIndex: 2
        }}></div>

        {/* Step Circles & Labels */}
        {steps.map((step) => {
          const isDone = currentStep > step.num;
          const isActive = currentStep === step.num;

          return (
            <div key={step.num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 3 }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.85rem',
                fontWeight: 'bold',
                lineHeight: 1,
                padding: 0,
                margin: 0,
                textAlign: 'center',
                backgroundColor: isDone ? '#15803d' : isActive ? 'var(--primary)' : 'white',
                color: isDone || isActive ? 'white' : '#64748b',
                border: isDone ? '2px solid #15803d' : isActive ? '2px solid var(--primary)' : '2px solid #cbd5e1',
                boxShadow: isActive ? '0 0 0 3px rgba(30, 58, 138, 0.2)' : 'none',
                transition: 'all 0.2s ease'
              }}>
                <span style={{ lineHeight: 1, display: 'block', transform: 'translateY(-0.5px)' }}>
                  {isDone ? '✓' : step.num}
                </span>
              </div>
              <span style={{
                fontSize: '0.725rem',
                marginTop: '0.25rem',
                fontWeight: isActive ? 'bold' : 'normal',
                color: isActive ? 'var(--primary)' : isDone ? '#15803d' : 'var(--text-muted)',
                whiteSpace: 'nowrap'
              }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
