import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Check
} from 'lucide-react';
import {
  THAI_MONTHS_FULL,
  THAI_MONTHS_SHORT,
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
 * True Thai Buddhist Era (พ.ศ.) Date Picker Component with Grid Selection
 *
 * Features:
 * - True Thai Buddhist Era calendar (เดือนภาษาไทย, ปี พ.ศ. เช่น 2568, 2569, 2570)
 * - Clickable Month (3x4) and Year (3x4) selection grids (no native dropdowns)
 * - Pure calendar view navigation: changing month/year never alters form value
 * - Vertical & Horizontal Adaptive Collision Detection (Auto Flip, Align Right/Left)
 * - 44px Minimum Touch Height & Focus Restoration
 * - Isolated Escape key handling via capture phase (prevents unintended parent modal dismissal)
 * - Mobile responsive bottom sheet mode
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
  const [openUpward, setOpenUpward] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState({});

  // View mode: 'DAY_VIEW' | 'MONTH_PICKER' | 'YEAR_PICKER'
  const [pickerView, setPickerView] = useState('DAY_VIEW');

  // Calendar view state (in CE year and 0-indexed month)
  const today = new Date();
  const currentCeYear = today.getFullYear();
  const currentMonth = today.getMonth();

  const [viewYear, setViewYear] = useState(currentCeYear);
  const [viewMonth, setViewMonth] = useState(currentMonth);

  // Year range start in Buddhist Era (12 years per page)
  const [yearPageStart, setYearPageStart] = useState(() => {
    const be = toBuddhistYear(currentCeYear);
    return Math.floor((be - 4) / 12) * 12 + 4;
  });

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);

  // Sync internal text and view state with external ISO `value`
  useEffect(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      const [y, m, d] = value.trim().split('-').map(Number);
      setInputText(formatThaiDate(value));
      setViewYear(y);
      setViewMonth(m - 1);
      const be = toBuddhistYear(y);
      setYearPageStart(Math.floor((be - 4) / 12) * 12 + 4);
    } else {
      setInputText('');
    }
  }, [value]);

  // Reset pickerView when opened
  useEffect(() => {
    if (isOpen) {
      setPickerView('DAY_VIEW');
      const be = toBuddhistYear(viewYear);
      setYearPageStart(Math.floor((be - 4) / 12) * 12 + 4);
    }
  }, [isOpen]);

  // Adaptive alignment, collision check, and portal positioning on open
  useEffect(() => {
    if (isOpen) {
      const checkPlacement = () => {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        if (windowWidth <= 640) {
          setIsMobileView(true);
          setAlignRight(false);
          setOpenUpward(false);
          setPopoverStyle({});
          return;
        }

        setIsMobileView(false);

        if (inputRef.current) {
          const rect = inputRef.current.getBoundingClientRect();
          const popoverWidth = 320;
          const popoverHeight = 350;

          // Vertical collision: if space below in viewport < popoverHeight and space above > popoverHeight, open upward
          const spaceBelow = windowHeight - rect.bottom;
          const spaceAbove = rect.top;
          const shouldOpenUpward = spaceBelow < popoverHeight && spaceAbove > popoverHeight;
          setOpenUpward(shouldOpenUpward);

          // Horizontal alignment
          let isRight = false;
          if (align === 'right') {
            isRight = true;
          } else if (align === 'left') {
            isRight = false;
          } else {
            if (windowWidth - rect.left < popoverWidth + 20 || rect.right > windowWidth - 20) {
              isRight = true;
            } else {
              const drawer = inputRef.current.closest('.crm-drawer-panel, .crm-modal-dialog');
              if (drawer) {
                const drawerRect = drawer.getBoundingClientRect();
                if (drawerRect.right - rect.left < popoverWidth + 10) {
                  isRight = true;
                }
              }
            }
          }
          setAlignRight(isRight);

          let left = isRight ? Math.max(12, rect.right - popoverWidth) : Math.min(rect.left, windowWidth - popoverWidth - 12);
          let top = shouldOpenUpward
            ? Math.max(12, rect.top - popoverHeight - 6)
            : Math.min(windowHeight - popoverHeight - 12, rect.bottom + 6);

          setPopoverStyle({
            position: 'fixed',
            top: `${Math.round(top)}px`,
            left: `${Math.round(left)}px`,
            width: `${popoverWidth}px`,
            zIndex: 99999
          });
        }
      };

      checkPlacement();
      window.addEventListener('resize', checkPlacement);
      window.addEventListener('scroll', checkPlacement, true);
      return () => {
        window.removeEventListener('resize', checkPlacement);
        window.removeEventListener('scroll', checkPlacement, true);
      };
    }
  }, [isOpen, align, pickerView]);

  // Capture phase Escape listener: intercepts Escape when calendar is open
  // This isolates calendar closing and prevents parent modals from dismissing
  useEffect(() => {
    if (!isOpen) return;

    const handleCaptureKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        setIsOpen(false);
        setPickerView('DAY_VIEW');
        setInputText(value ? formatThaiDate(value) : '');
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleCaptureKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleCaptureKeyDown, true);
    };
  }, [isOpen, value]);

  // Close calendar popup on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target) &&
        (!popoverRef.current || !popoverRef.current.contains(event.target))
      ) {
        setIsOpen(false);
        setPickerView('DAY_VIEW');
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
      setInputText(value ? formatThaiDate(value) : '');
    }
  };

  const handleInputChange = (e) => {
    const rawVal = e.target.value;
    setInputText(rawVal);

    if (rawVal.trim().length === 10) {
      const parsedIso = parseThaiDateInput(rawVal);
      if (parsedIso) {
        if (onChange) onChange(parsedIso);
        const [y, m] = parsedIso.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
        const be = toBuddhistYear(y);
        setYearPageStart(Math.floor((be - 4) / 12) * 12 + 4);
      }
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommitText();
      setIsOpen(false);
      setPickerView('DAY_VIEW');
      inputRef.current?.focus();
    }
  };

  // Month navigation in DAY_VIEW
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

  // Select a day (ONLY this triggers onChange and updates the date)
  const handleSelectDay = (day, targetMonth, targetYear) => {
    const isoString = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (minDate && isoString < minDate) return;
    if (maxDate && isoString > maxDate) return;

    if (onChange) onChange(isoString);
    setInputText(formatThaiDate(isoString));
    setViewMonth(targetMonth);
    setViewYear(targetYear);
    setIsOpen(false);
    setPickerView('DAY_VIEW');
    inputRef.current?.focus();
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
    setPickerView('DAY_VIEW');
    inputRef.current?.focus();
  };

  // Quick action: Clear
  const handleClear = (e) => {
    e.stopPropagation();
    if (disabled) return;
    if (onChange) onChange('');
    setInputText('');
    setIsOpen(false);
    setPickerView('DAY_VIEW');
    inputRef.current?.focus();
  };

  // Generate Calendar Days Grid for DAY_VIEW
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
      ref={popoverRef}
      className={`thai-datepicker-popover ${alignRight ? 'align-right' : 'align-left'} ${openUpward ? 'open-upward' : ''} ${isMobileView ? 'mobile-sheet' : ''}`}
      style={!isMobileView ? popoverStyle : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Mobile Sheet Top Bar */}
      {isMobileView && (
        <div className="thai-datepicker-sheet-header">
          <span className="thai-datepicker-sheet-title">
            {pickerView === 'DAY_VIEW' && 'เลือกวันที่ (พ.ศ.)'}
            {pickerView === 'MONTH_PICKER' && `เลือกเดือน (พ.ศ. ${toBuddhistYear(viewYear)})`}
            {pickerView === 'YEAR_PICKER' && `เลือกปี พ.ศ. (${yearPageStart} - ${yearPageStart + 11})`}
          </span>
          <button
            type="button"
            className="thai-datepicker-sheet-close"
            onClick={() => {
              setIsOpen(false);
              setPickerView('DAY_VIEW');
              inputRef.current?.focus();
            }}
            title="ปิดหน้าต่าง"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* 1. DAY VIEW */}
      {pickerView === 'DAY_VIEW' && (
        <>
          {/* Header: Prev Month, Month & Buddhist Year Buttons with Caret, Next Month */}
          <div className="thai-datepicker-header">
            <button
              type="button"
              className="thai-datepicker-nav-btn"
              onClick={handlePrevMonth}
              title="เดือนก่อนหน้า"
              tabIndex={-1}
            >
              <ChevronLeft size={16} />
            </button>

            <div className="thai-datepicker-view-buttons">
              <button
                type="button"
                className="thai-datepicker-title-btn month-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerView('MONTH_PICKER');
                }}
                title="คลิกเพื่อเลือกเดือนแบบ Grid"
              >
                <span>{THAI_MONTHS_FULL[viewMonth]}</span>
                <ChevronDown size={14} className="thai-datepicker-title-caret" />
              </button>

              <button
                type="button"
                className="thai-datepicker-title-btn year-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  const be = toBuddhistYear(viewYear);
                  const start = Math.floor((be - 4) / 12) * 12 + 4;
                  setYearPageStart(start);
                  setPickerView('YEAR_PICKER');
                }}
                title="คลิกเพื่อเลือกปี พ.ศ. แบบ Grid"
              >
                <span>พ.ศ. {toBuddhistYear(viewYear)}</span>
                <ChevronDown size={14} className="thai-datepicker-title-caret" />
              </button>
            </div>

            <button
              type="button"
              className="thai-datepicker-nav-btn"
              onClick={handleNextMonth}
              title="เดือนถัดไป"
              tabIndex={-1}
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

          {/* Popover Footer: Clean Corporate Actions */}
          <div className="thai-datepicker-footer">
            <button
              type="button"
              className="thai-datepicker-footer-btn today"
              onClick={handleSelectToday}
            >
              วันนี้
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
        </>
      )}

      {/* 2. MONTH PICKER (3 cols x 4 rows = 12 months) */}
      {pickerView === 'MONTH_PICKER' && (
        <div className="thai-datepicker-grid-view">
          <div className="thai-datepicker-header">
            <button
              type="button"
              className="thai-datepicker-nav-btn back-btn"
              onClick={() => setPickerView('DAY_VIEW')}
              title="กลับสู่ปฏิทิน"
              tabIndex={-1}
            >
              <ChevronLeft size={16} />
            </button>

            <div className="thai-datepicker-picker-title">
              <span>เลือกเดือน (พ.ศ. {toBuddhistYear(viewYear)})</span>
            </div>

            <div style={{ width: 28, height: 28 }} />
          </div>

          <div className="thai-datepicker-month-grid">
            {THAI_MONTHS_SHORT.map((mShort, idx) => {
              const isSelected = viewMonth === idx;
              const isCurrentMonth = today.getMonth() === idx && today.getFullYear() === viewYear;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`thai-datepicker-month-cell ${isSelected ? 'selected' : ''} ${isCurrentMonth ? 'current-month' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMonth(idx);
                    setPickerView('DAY_VIEW');
                  }}
                  title={THAI_MONTHS_FULL[idx]}
                >
                  <span className="thai-month-short">{mShort}</span>
                  <span className="thai-month-full">{THAI_MONTHS_FULL[idx]}</span>
                </button>
              );
            })}
          </div>

          <div className="thai-datepicker-footer picker-footer">
            <button
              type="button"
              className="thai-datepicker-footer-btn back"
              onClick={() => setPickerView('DAY_VIEW')}
            >
              ย้อนกลับไปปฏิทิน
            </button>
          </div>
        </div>
      )}

      {/* 3. YEAR PICKER (3 cols x 4 rows = 12 years per page) */}
      {pickerView === 'YEAR_PICKER' && (
        <div className="thai-datepicker-grid-view">
          <div className="thai-datepicker-header">
            <button
              type="button"
              className="thai-datepicker-nav-btn"
              onClick={(e) => {
                e.stopPropagation();
                setYearPageStart(prev => prev - 12);
              }}
              title="12 ปีก่อนหน้า"
              tabIndex={-1}
            >
              <ChevronLeft size={16} />
            </button>

            <button
              type="button"
              className="thai-datepicker-picker-title clickable"
              onClick={() => setPickerView('DAY_VIEW')}
              title="กลับสู่ปฏิทิน"
            >
              <span>พ.ศ. {yearPageStart} - {yearPageStart + 11}</span>
            </button>

            <button
              type="button"
              className="thai-datepicker-nav-btn"
              onClick={(e) => {
                e.stopPropagation();
                setYearPageStart(prev => prev + 12);
              }}
              title="12 ปีถัดไป"
              tabIndex={-1}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="thai-datepicker-year-grid">
            {Array.from({ length: 12 }, (_, i) => yearPageStart + i).map((beYear) => {
              const isSelected = toBuddhistYear(viewYear) === beYear;
              const isThisYear = toBuddhistYear(today.getFullYear()) === beYear;
              return (
                <button
                  key={beYear}
                  type="button"
                  className={`thai-datepicker-year-cell ${isSelected ? 'selected' : ''} ${isThisYear ? 'current-year' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewYear(toGregorianYear(beYear));
                    setPickerView('DAY_VIEW');
                  }}
                  title={`ปี พ.ศ. ${beYear}`}
                >
                  <span className="thai-year-number">{beYear}</span>
                </button>
              );
            })}
          </div>

          <div className="thai-datepicker-footer picker-footer">
            <button
              type="button"
              className="thai-datepicker-footer-btn back"
              onClick={() => setPickerView('DAY_VIEW')}
            >
              ย้อนกลับไปปฏิทิน
            </button>
          </div>
        </div>
      )}
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
              <X size={15} />
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
            <CalendarIcon size={17} />
          </button>
        </div>
      </div>

      {/* Popover or Mobile Backdrop Dialog via Body Portal */}
      {isOpen && (
        isMobileView ? (
          createPortal(
            <div
              className="thai-datepicker-mobile-backdrop"
              onClick={() => {
                setIsOpen(false);
                setPickerView('DAY_VIEW');
                inputRef.current?.focus();
              }}
            >
              {popoverContent}
            </div>,
            document.body
          )
        ) : (
          createPortal(
            popoverContent,
            document.body
          )
        )
      )}
    </div>
  );
}
