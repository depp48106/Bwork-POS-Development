import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
  Check
} from 'lucide-react';
import {
  THAI_MONTHS_FULL,
  THAI_WEEKDAYS_SHORT,
  formatThaiDate,
  parseThaiDateInput,
  getDaysInMonth,
  toBuddhistYear,
  toGregorianYear
} from '../utils/thaiDateHelper';
import './ThaiDatePicker.css';

/**
 * ThaiDatePicker
 * True Thai Buddhist Era (พ.ศ.) Date Picker Component
 *
 * Features:
 * - True Thai Buddhist Era calendar (เดือนภาษาไทย, ปี พ.ศ. เช่น 2568, 2569, 2570)
 * - Adaptive positioning (Auto Flip / Align Right to prevent viewport/drawer clipping)
 * - Mobile responsive sheet / dialog mode (prevents parent scroll clipping on small screens)
 * - Zero horizontal scrollbar
 * - Direct text typing in DD/MM/BBBB with leap year validation (29/02/2571 allowed, 29/02/2569 rejected)
 * - ISO YYYY-MM-DD standard payload for zero breaking changes to APIs
 */
export default function ThaiDatePicker({
  value = '',
  onChange,
  placeholder = 'วว/ดด/ปปปป (พ.ศ.)',
  disabled = false,
  required = false,
  minDate = '',
  maxDate = '',
  className = '',
  align = 'auto', // 'auto' | 'left' | 'right'
  id
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);

  // Calendar view state (in CE year and 0-indexed month)
  const today = new Date();
  const currentCeYear = today.getFullYear();
  const currentMonth = today.getMonth();

  const [viewYear, setViewYear] = useState(currentCeYear);
  const [viewMonth, setViewMonth] = useState(currentMonth);

  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Sync internal text and view state with external ISO `value`
  useEffect(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      const [y, m, d] = value.trim().split('-').map(Number);
      setInputText(formatThaiDate(value));
      setViewYear(y);
      setViewMonth(m - 1);
    } else {
      setInputText('');
    }
  }, [value]);

  // Adaptive alignment check on open
  useEffect(() => {
    if (isOpen) {
      const checkPlacement = () => {
        const windowWidth = window.innerWidth;
        if (windowWidth <= 640) {
          setIsMobileView(true);
          setAlignRight(false);
          return;
        }

        setIsMobileView(false);
        if (align === 'right') {
          setAlignRight(true);
        } else if (align === 'left') {
          setAlignRight(false);
        } else if (inputRef.current) {
          const rect = inputRef.current.getBoundingClientRect();
          // If input is near the right edge of the screen or right edge of a container (<330px room to the right)
          if (windowWidth - rect.left < 340 || rect.right > windowWidth - 40) {
            setAlignRight(true);
          } else {
            // Also check container boundary if inside a drawer
            const drawer = inputRef.current.closest('.crm-drawer-panel, .crm-modal-dialog');
            if (drawer) {
              const drawerRect = drawer.getBoundingClientRect();
              if (drawerRect.right - rect.left < 330) {
                setAlignRight(true);
                return;
              }
            }
            setAlignRight(false);
          }
        }
      };

      checkPlacement();
      window.addEventListener('resize', checkPlacement);
      return () => window.removeEventListener('resize', checkPlacement);
    }
  }, [isOpen, align]);

  // Close calendar popup on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        // Also check if click was on a mobile modal backdrop
        const popoverEl = document.querySelector('.thai-datepicker-popover.mobile-sheet');
        if (popoverEl && popoverEl.contains(event.target)) {
          return;
        }
        setIsOpen(false);
        handleCommitText();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, inputText, value]);

  // Commit text input to ISO date
  const handleCommitText = () => {
    if (!inputText.trim()) {
      if (!required && value) {
        if (onChange) onChange('');
      } else if (value) {
        setInputText(formatThaiDate(value));
      }
      return;
    }

    const parsedIso = parseThaiDateInput(inputText);
    if (parsedIso) {
      if (minDate && parsedIso < minDate) {
        setInputText(formatThaiDate(value || minDate));
        if (onChange) onChange(value || minDate);
        return;
      }
      if (maxDate && parsedIso > maxDate) {
        setInputText(formatThaiDate(value || maxDate));
        if (onChange) onChange(value || maxDate);
        return;
      }
      if (onChange) onChange(parsedIso);
      setInputText(formatThaiDate(parsedIso));
    } else {
      // Revert if invalid
      setInputText(value ? formatThaiDate(value) : '');
    }
  };

  const handleInputChange = (e) => {
    const rawVal = e.target.value;
    setInputText(rawVal);

    // Auto-parse if user typed complete valid date (e.g. 10 chars "DD/MM/BBBB")
    if (rawVal.trim().length === 10) {
      const parsedIso = parseThaiDateInput(rawVal);
      if (parsedIso) {
        if (onChange) onChange(parsedIso);
        const [y, m] = parsedIso.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      }
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommitText();
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setInputText(value ? formatThaiDate(value) : '');
    }
  };

  // Month navigation
  const handlePrevMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(prev => prev - 1);
    } else {
      setViewMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(prev => prev + 1);
    } else {
      setViewMonth(prev => prev + 1);
    }
  };

  // Select a day
  const handleSelectDay = (day, targetMonth, targetYear) => {
    const isoString = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (minDate && isoString < minDate) return;
    if (maxDate && isoString > maxDate) return;

    if (onChange) onChange(isoString);
    setInputText(formatThaiDate(isoString));
    setViewMonth(targetMonth);
    setViewYear(targetYear);
    setIsOpen(false);
  };

  // Quick action: Today
  const handleSelectToday = (e) => {
    e.stopPropagation();
    const todayIso = today.toISOString().slice(0, 10);
    if (minDate && todayIso < minDate) return;
    if (maxDate && todayIso > maxDate) return;

    if (onChange) onChange(todayIso);
    setInputText(formatThaiDate(todayIso));
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setIsOpen(false);
  };

  // Quick action: Clear
  const handleClear = (e) => {
    e.stopPropagation();
    if (disabled) return;
    if (onChange) onChange('');
    setInputText('');
    setIsOpen(false);
  };

  // Generate Year range (Current BE +/- 10 years)
  const currentBe = toBuddhistYear(currentCeYear);
  const yearOptions = [];
  for (let be = currentBe - 6; be <= currentBe + 10; be++) {
    yearOptions.push({
      beYear: be,
      ceYear: toGregorianYear(be)
    });
  }

  // Generate Calendar Days Grid
  const daysInCurrentMonth = getDaysInMonth(viewYear, viewMonth + 1);
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
  const daysInPrevMonth = getDaysInMonth(viewYear, viewMonth === 0 ? 12 : viewMonth);

  const prevMonthCells = [];
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const targetMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const targetYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    prevMonthCells.push({
      day: d,
      month: targetMonth,
      year: targetYear,
      isCurrentMonth: false
    });
  }

  const currentMonthCells = [];
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    currentMonthCells.push({
      day: d,
      month: viewMonth,
      year: viewYear,
      isCurrentMonth: true
    });
  }

  const totalCellsSoFar = prevMonthCells.length + currentMonthCells.length;
  const nextMonthCells = [];
  const remainingCells = totalCellsSoFar <= 35 ? 35 - totalCellsSoFar : 42 - totalCellsSoFar;
  for (let d = 1; d <= remainingCells; d++) {
    const targetMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const targetYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    nextMonthCells.push({
      day: d,
      month: targetMonth,
      year: targetYear,
      isCurrentMonth: false
    });
  }

  const allCells = [...prevMonthCells, ...currentMonthCells, ...nextMonthCells];

  const isCellSelected = (cell) => {
    if (!value) return false;
    const isoString = `${cell.year}-${String(cell.month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
    return isoString === value;
  };

  const isCellToday = (cell) => {
    return (
      cell.day === today.getDate() &&
      cell.month === today.getMonth() &&
      cell.year === today.getFullYear()
    );
  };

  const isCellDisabled = (cell) => {
    const isoString = `${cell.year}-${String(cell.month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
    if (minDate && isoString < minDate) return true;
    if (maxDate && isoString > maxDate) return true;
    return false;
  };

  const popoverContent = (
    <div
      className={`thai-datepicker-popover ${alignRight ? 'align-right' : 'align-left'} ${isMobileView ? 'mobile-sheet' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Mobile Sheet Top Bar */}
      {isMobileView && (
        <div className="thai-datepicker-sheet-header">
          <span className="thai-datepicker-sheet-title">เลือกวันที่ (พ.ศ.)</span>
          <button
            type="button"
            className="thai-datepicker-sheet-close"
            onClick={() => setIsOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Header: Month & Buddhist Year Selectors + Navigation */}
      <div className="thai-datepicker-header">
        <button
          type="button"
          className="thai-datepicker-nav-btn"
          onClick={handlePrevMonth}
          title="เดือนก่อนหน้า"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="thai-datepicker-selects">
          {/* Thai Month Dropdown */}
          <select
            className="thai-datepicker-select month"
            value={viewMonth}
            onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
          >
            {THAI_MONTHS_FULL.map((mName, idx) => (
              <option key={idx} value={idx}>
                {mName}
              </option>
            ))}
          </select>

          {/* Thai Buddhist Year Dropdown */}
          <select
            className="thai-datepicker-select year"
            value={viewYear}
            onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
          >
            {yearOptions.map(opt => (
              <option key={opt.beYear} value={opt.ceYear}>
                พ.ศ. {opt.beYear}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="thai-datepicker-nav-btn"
          onClick={handleNextMonth}
          title="เดือนถัดไป"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday Names Header */}
      <div className="thai-datepicker-weekdays">
        {THAI_WEEKDAYS_SHORT.map((wd, i) => (
          <div
            key={i}
            className={`thai-datepicker-weekday ${i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}`}
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="thai-datepicker-days-grid">
        {allCells.map((cell, idx) => {
          const selected = isCellSelected(cell);
          const isToday = isCellToday(cell);
          const isDisabled = isCellDisabled(cell);

          let cellClass = 'thai-datepicker-day-cell';
          if (!cell.isCurrentMonth) cellClass += ' outside-month';
          if (selected) cellClass += ' selected';
          if (isToday) cellClass += ' today';
          if (isDisabled) cellClass += ' disabled';

          return (
            <button
              key={idx}
              type="button"
              className={cellClass}
              disabled={isDisabled}
              onClick={() => handleSelectDay(cell.day, cell.month, cell.year)}
              title={`${cell.day} ${THAI_MONTHS_FULL[cell.month]} พ.ศ. ${toBuddhistYear(cell.year)}`}
            >
              <span className="thai-datepicker-day-number">{cell.day}</span>
            </button>
          );
        })}
      </div>

      {/* Popover Footer: Quick Actions */}
      <div className="thai-datepicker-footer">
        <button
          type="button"
          className="thai-datepicker-footer-btn today"
          onClick={handleSelectToday}
        >
          วันนี้ ({formatThaiDate(today.toISOString().slice(0, 10))})
        </button>

        {!required && (
          <button
            type="button"
            className="thai-datepicker-footer-btn clear"
            onClick={handleClear}
          >
            ล้างค่า
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={`thai-datepicker-container ${className} ${disabled ? 'disabled' : ''}`} ref={containerRef}>
      <div className="thai-datepicker-input-wrap" onClick={() => !disabled && setIsOpen(true)}>
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="thai-datepicker-input"
          placeholder={placeholder}
          value={inputText}
          onChange={handleInputChange}
          onBlur={handleCommitText}
          onKeyDown={handleInputKeyDown}
          disabled={disabled}
          required={required}
        />
        <div className="thai-datepicker-icons">
          {!required && value && !disabled && (
            <button
              type="button"
              className="thai-datepicker-clear-btn"
              onClick={handleClear}
              title="ล้างวันที่"
              tabIndex={-1}
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            className="thai-datepicker-calendar-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) setIsOpen(prev => !prev);
            }}
            title="เปิดปฏิทินไทย (พ.ศ.)"
            tabIndex={-1}
          >
            <CalendarIcon size={16} />
          </button>
        </div>
      </div>

      {/* Popover or Mobile Backdrop Dialog */}
      {isOpen && (
        isMobileView ? (
          <div className="thai-datepicker-mobile-backdrop" onClick={() => setIsOpen(false)}>
            {popoverContent}
          </div>
        ) : (
          popoverContent
        )
      )}
    </div>
  );
}
