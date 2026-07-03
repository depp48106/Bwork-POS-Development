import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Minus, Trash2, Calendar, ShoppingCart, Printer, X, CreditCard, User, Building, Phone, FileText, Check, ChevronLeft, ChevronRight, Clock, Search, ChevronUp, ChevronDown } from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';
import CustomDatePicker from './CustomDatePicker';

function BookingPOS({ user, settings, sysAlert, preselectedRoom, clearPreselectedRoom, onNavigate }) {
  const [rooms, setRooms] = useState([]);
  const [services, setServices] = useState([]);
  const [cart, setCart] = useState([]);
  const [showCartSidebar, setShowCartSidebar] = useState(false);
  const [monthSearchQuery, setMonthSearchQuery] = useState('');
  const [selectedRoomsFilter, setSelectedRoomsFilter] = useState({}); // e.g. { roomId: true/false }
  const [showMonthSelector, setShowMonthSelector] = useState(false);
  
  // Customer details
  const [customer, setCustomer] = useState({
    name: '',
    department: '',
    contact: ''
  });
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');

  // Calendar state
  const today = new Date();
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth()); // 0-indexed
  const [calendarEvents, setCalendarEvents] = useState([]);

  // Day Modal state (when clicking a day)
  const [selectedDay, setSelectedDay] = useState({
    day: today.getDate(),
    month: today.getMonth(),
    year: today.getFullYear(),
    isOtherMonth: false
  });
  const [isDayModalOpen, setIsDayModalOpen] = useState(false);

  // Sidebar selected day state (only changed when clicking mini-calendar)
  const [sidebarSelectedDay, setSidebarSelectedDay] = useState({
    day: today.getDate(),
    month: today.getMonth(),
    year: today.getFullYear(),
    isOtherMonth: false
  });
  const [modalCategory, setModalCategory] = useState('all'); // 'all', 'room', 'Co-Working', 'Koocafe', 'Parking'

  // Room scheduling modal (sub-modal from day modal)
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [bookingType, setBookingType] = useState('hourly'); // 'hourly' | 'daily'
  const [dailyTimeSlot, setDailyTimeSlot] = useState('08-17'); // '08-17' | '09-18'
  const [layoutType, setLayoutType] = useState('standard'); // 'standard' | 'classroom'
  const [roomSchedule, setRoomSchedule] = useState({
    date: new Date().toISOString().split('T')[0],
    startHour: '09',
    startMinute: '00',
    endHour: '10',
    endMinute: '00'
  });

  // Service selection modal
  const [showServicePicker, setShowServicePicker] = useState(false);

  // Printing State
  const [printBooking, setPrintBooking] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // =========================================================
  // DATA FETCHING
  // =========================================================
  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    fetchCalendarEvents();
  }, [calendarYear, calendarMonth]);

  const fetchItems = async () => {
    try {
      const roomsRes = await fetch('/api/rooms?status=active');
      const servicesRes = await fetch('/api/services?status=active');
      if (roomsRes.ok && servicesRes.ok) {
        setRooms(await roomsRes.json());
        setServices(await servicesRes.json());
      }
    } catch (err) {
      console.error('Failed to load POS catalog:', err);
    }
  };

  const fetchCalendarEvents = async () => {
    try {
      const res = await fetch(`/api/bookings/calendar?month=${calendarMonth + 1}&year=${calendarYear}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarEvents(data);
      }
    } catch (err) {
      console.error('Failed to fetch calendar events:', err);
    }
  };

  // =========================================================
  // CALENDAR HELPERS
  // =========================================================
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const weekdays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();

    // Previous month fill
    const prevMonthLast = new Date(calendarYear, calendarMonth, 0);
    const prevMonthDays = prevMonthLast.getDate();

    const days = [];

    // Fill previous month days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const prevMonth = calendarMonth === 0 ? 11 : calendarMonth - 1;
      const prevYear = calendarMonth === 0 ? calendarYear - 1 : calendarYear;
      days.push({ day, month: prevMonth, year: prevYear, isOtherMonth: true });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: calendarMonth, year: calendarYear, isOtherMonth: false });
    }

    // Next month fill (complete to 6 rows = 42 cells, or 5 rows = 35 cells)
    const totalCells = days.length <= 35 ? 35 : 42;
    const remaining = totalCells - days.length;
    for (let i = 1; i <= remaining; i++) {
      const nextMonth = calendarMonth === 11 ? 0 : calendarMonth + 1;
      const nextYear = calendarMonth === 11 ? calendarYear + 1 : calendarYear;
      days.push({ day: i, month: nextMonth, year: nextYear, isOtherMonth: true });
    }

    return days;
  }, [calendarYear, calendarMonth]);

  const monthNamesEng = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Filter events by selected rooms from sidebar checkboxes
  const filteredEventsByDay = useMemo(() => {
    const map = {};
    calendarEvents.forEach(ev => {
      // Check if room filter is empty or room is checked
      const isFiltered = Object.keys(selectedRoomsFilter).length > 0 && selectedRoomsFilter[ev.room_id] === false;
      if (isFiltered) return; // skip this event since it's filtered out!
      
      const dateStr = new Date(ev.start_time).toISOString().split('T')[0];
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(ev);
    });
    return map;
  }, [calendarEvents, selectedRoomsFilter]);

  // Keep original events list for calculations
  const eventsByDay = useMemo(() => {
    const map = {};
    calendarEvents.forEach(ev => {
      const dateStr = new Date(ev.start_time).toISOString().split('T')[0];
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(ev);
    });
    return map;
  }, [calendarEvents]);

  const isToday = (day, month, year) => {
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const goToToday = () => {
    setCalendarYear(today.getFullYear());
    setCalendarMonth(today.getMonth());
  };

  const goToPrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(calendarYear - 1);
    } else {
      setCalendarMonth(calendarMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(calendarYear + 1);
    } else {
      setCalendarMonth(calendarMonth + 1);
    }
  };

  const getDateKey = (day, month, year) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Select day bookings list for sidebar agenda view (depends on sidebarSelectedDay)
  const selectedDayBookings = useMemo(() => {
    if (!sidebarSelectedDay) return [];
    const dateKey = getDateKey(sidebarSelectedDay.day, sidebarSelectedDay.month, sidebarSelectedDay.year);
    return eventsByDay[dateKey] || [];
  }, [sidebarSelectedDay, eventsByDay]);

  // =========================================================
  // CLICK DAY -> OPEN DAY MODAL
  // =========================================================
  const handleDayClick = (dayObj) => {
    setSelectedDay(dayObj);
    if (dayObj.month !== calendarMonth || dayObj.year !== calendarYear) {
      setCalendarMonth(dayObj.month);
      setCalendarYear(dayObj.year);
    }
  };

  // CLICK MINI CALENDAR DAY -> UPDATE SIDEBAR AGENDA
  const handleMiniDayClick = (dayObj) => {
    setSidebarSelectedDay(dayObj);
    if (dayObj.month !== calendarMonth || dayObj.year !== calendarYear) {
      setCalendarMonth(dayObj.month);
      setCalendarYear(dayObj.year);
    }
  };

  // =========================================================
  // ROOM BOOKING FLOW (from day modal)
  // =========================================================
  const openRoomModalFromDay = (room) => {
    if (!selectedDay) return;
    setSelectedRoom(room);
    setBookingType('hourly');
    setDailyTimeSlot('08-17');
    setLayoutType('standard');
    const now = new Date();
    const currHour = now.getHours();
    const startHourVal = String((currHour + 1) % 24).padStart(2, '0');
    const endHourVal = String((currHour + 2) % 24).padStart(2, '0');
    setRoomSchedule({
      date: getDateKey(selectedDay.day, selectedDay.month, selectedDay.year),
      startHour: startHourVal,
      startMinute: '00',
      endHour: endHourVal,
      endMinute: '00'
    });
    setPaymentStatus('');
    setPaymentMethod('');
  };

  // Automatically trigger schedule modal if room was preselected from layout status page
  useEffect(() => {
    if (preselectedRoom) {
      // Set today's date as selected day first
      setSelectedDay({ day: today.getDate(), month: today.getMonth(), year: today.getFullYear(), isOtherMonth: false });
      setTimeout(() => {
        openRoomModalFromDay(preselectedRoom);
      }, 100);
      clearPreselectedRoom();
    }
  }, [preselectedRoom]);

  // Handle preselected room after selectedDay is set
  useEffect(() => {
    if (preselectedRoom && selectedDay) {
      setSelectedRoom(preselectedRoom);
      const now = new Date();
      const currHour = now.getHours();
      const startHourVal = String((currHour + 1) % 24).padStart(2, '0');
      const endHourVal = String((currHour + 2) % 24).padStart(2, '0');
      setRoomSchedule({
        date: getDateKey(selectedDay.day, selectedDay.month, selectedDay.year),
        startHour: startHourVal,
        startMinute: '00',
        endHour: endHourVal,
        endMinute: '00'
      });
      clearPreselectedRoom();
    }
  }, [selectedDay, preselectedRoom]);

  // Download receipt as PDF with dynamic height based on items count
  const handleDownloadPDF = () => {
    if (!printBooking) return;
    const element = document.getElementById('print-receipt-area');
    if (!element) return;

    if (!window.html2pdf) {
      sysAlert('ระบบพิมพ์ PDF ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง');
      return;
    }

    element.classList.add('pdf-export-mode');

    let estimatedHeight = 85;
    if (printBooking.items) {
      printBooking.items.forEach(item => {
        estimatedHeight += 11;
      });
    }

    const opt = {
      margin:       [0, 0, 0, 0],
      filename:     `receipt-${String(printBooking.id).padStart(6, '0')}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 3, useCORS: true, letterRendering: true },
      jsPDF:        { unit: 'mm', format: [72, estimatedHeight], orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    window.html2pdf().from(element).set(opt).save().then(() => {
      element.classList.remove('pdf-export-mode');
    }).catch(err => {
      element.classList.remove('pdf-export-mode');
      console.error(err);
    });
  };

  // Close receipt modal and dynamically navigate to correct workspace tab
  const handleCloseReceiptModal = () => {
    setShowReceiptModal(false);
    if (printBooking) {
      if (printBooking.payment_status === 'paid' && onNavigate) {
        onNavigate('history');
      } else if (printBooking.payment_status === 'pending' && onNavigate) {
        onNavigate('pending');
      }
    }
  };

  // Add Room to cart with schedule details
  const addRoomToCart = async () => {
    if (!selectedRoom) return;

    if (!customer.name.trim()) {
      sysAlert('กรุณากรอ�    if (bookingType === 'daily') {
      // Daily booking
      const [startH, endH] = dailyTimeSlot === '08-17' ? ['08', '17'] : ['09', '18'];
      startTimeStr = `${startH}:00`;
      endTimeStr = `${endH}:00`;
      startDateTime = new Date(`${roomSchedule.date}T${startTimeStr}`);
      endDateTime = new Date(`${roomSchedule.date}T${endTimeStr}`);
      price = layoutType === 'classroom' ? (selectedRoom.classroom_daily_rate || 0) : (selectedRoom.daily_rate || 0);
      quantity = 1;
      subtotal = price;

      if (price <= 0) {
        sysAlert('ราคารายวันของรูปแบบที่เลือกยังไม่ได้ถูกตั้งค่า กรุณาตั้งค่าราคารายวันก่อน');
        return;
      }
    } else if (bookingType === 'halfday') {
      // Half-day booking
      const [startH, endH] = dailyTimeSlot === '08-12' ? ['08', '12'] : ['13', '17'];
      startTimeStr = `${startH}:00`;
      endTimeStr = `${endH}:00`;
      startDateTime = new Date(`${roomSchedule.date}T${startTimeStr}`);
      endDateTime = new Date(`${roomSchedule.date}T${endTimeStr}`);
      price = selectedRoom.half_day_rate || 0;
      quantity = 1;
      subtotal = price;

      if (price <= 0) {
        sysAlert('ราคารายครึ่งวันของห้องประชุมนี้ยังไม่ได้ถูกตั้งค่า กรุณาตั้งค่าก่อน');
        return;
      }
    } else {
      // Hourly booking (original logic)
      const startHourPad = String(roomSchedule.startHour || '0').padStart(2, '0');
      const startMinPad = String(roomSchedule.startMinute || '0').padStart(2, '0');
      const endHourPad = String(roomSchedule.endHour || '0').padStart(2, '0');
      const endMinPad = String(roomSchedule.endMinute || '0').padStart(2, '0');

      startTimeStr = `${startHourPad}:${startMinPad}`;
      endTimeStr = `${endHourPad}:${endMinPad}`;

      // Validate 24HR range
      const sHourVal = parseInt(startHourPad, 10);
      const sMinVal = parseInt(startMinPad, 10);
      const eHourVal = parseInt(endHourPad, 10);
      const eMinVal = parseInt(endMinPad, 10);

      if (isNaN(sHourVal) || isNaN(sMinVal) || isNaN(eHourVal) || isNaN(eMinVal) ||
          sHourVal < 0 || sHourVal > 23 || sMinVal < 0 || sMinVal > 59 ||
          eHourVal < 0 || eHourVal > 23 || eMinVal < 0 || eMinVal > 59) {
        sysAlert('กรุณาระบุเวลาให้ถูกต้อง (ชั่วโมง 00-23, นาที 00-59)');
        return;
      }

      startDateTime = new Date(`${roomSchedule.date}T${startTimeStr}`);
      endDateTime = new Date(`${roomSchedule.date}T${endTimeStr}`);

      if (endDateTime <= startDateTime) {
        sysAlert('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้นจอง');
        return;
      }

      const diffMs = endDateTime - startDateTime;
      hours = Math.ceil(diffMs / (1000 * 60 * 60));
      price = layoutType === 'classroom' ? (selectedRoom.classroom_hourly_rate || 0) : (selectedRoom.hourly_rate || 0);
      quantity = hours;
      subtotal = hours * price;

      if (price <= 0) {
        sysAlert('ราคารายชั่วโมงของรูปแบบที่เลือกยังไม่ได้ถูกตั้งค่า กรุณาตั้งค่ารากาก่อน');
        return;
      }
    }00-59)');
        return;
      }

      startDateTime = new Date(`${roomSchedule.date}T${startTimeStr}`);
      endDateTime = new Date(`${roomSchedule.date}T${endTimeStr}`);

      if (endDateTime <= startDateTime) {
        sysAlert('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้นจอง');
        return;
      }

      const diffMs = endDateTime - startDateTime;
      hours = Math.ceil(diffMs / (1000 * 60 * 60));
      price = layoutType === 'classroom' ? (selectedRoom.classroom_hourly_rate || 0) : (selectedRoom.hourly_rate || 0);
      quantity = hours;
      subtotal = hours * price;

      if (price <= 0) {
        sysAlert('ราคารายชั่วโมงของรูปแบบที่เลือกยังไม่ได้ถูกตั้งค่า กรุณาตั้งค่าราคาก่อน');
        return;
      }
    }

    // Check overlap with database bookings
    try {
      const checkRes = await fetch(
        `/api/bookings/check-overlap?room_id=${selectedRoom.id}&start_time=${startDateTime.toISOString()}&end_time=${endDateTime.toISOString()}`
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.overlap) {
          const sTime = new Date(checkData.booking.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
          const eTime = new Date(checkData.booking.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
          sysAlert(
            `⚠️ ห้องนี้ไม่ว่างในช่วงเวลาดังกล่าว!\n\nมีผู้เข้าใช้งานแล้ว: คุณ ${checkData.booking.customer_name}\nช่วงเวลา: ${sTime} - ${eTime} น.`
          );
          return;
        }
      }
    } catch (err) {
      console.error('Failed to check room overlap:', err);
    }

    const uniqueKey = `room-${selectedRoom.id}-${roomSchedule.date}-${startTimeStr}-${bookingType}-${layoutType}`;

    const existing = cart.find(item => item.uniqueKey === uniqueKey);
    if (existing) {
      sysAlert('คุณได้ใส่ช่วงเวลานี้ของห้องนี้ลงในตะกร้าเรียบร้อยแล้ว');
      setSelectedRoom(null);
      return;
    }

    setCart([...cart, {
      uniqueKey,
      room_id: selectedRoom.id,
      room_name: selectedRoom.name,
      price: price,
      quantity: quantity,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      subtotal: subtotal,
      booking_type: bookingType, // 'hourly' or 'daily'
      layout: layoutType // 'standard' or 'classroom'
    }]);

    setSelectedRoom(null);
    setShowCartSidebar(true); // Auto-open cart sidebar when item added!
  };

  // Add Service directly to cart
  const addServiceToCartDirect = (service) => {
    const existing = cart.find(item => item.service_id === service.id);
    if (existing) {
      setCart(cart.map(item => 
        item.service_id === service.id 
          ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.price } 
          : item
      ));
    } else {
      setCart([...cart, {
        uniqueKey: `service-${service.id}-${Date.now()}`,
        service_id: service.id,
        service_name: service.name,
        price: service.price,
        quantity: 1,
        subtotal: service.price
      }]);
    }
    setShowServicePicker(false);
    setShowCartSidebar(true);
  };

  // Update Item Quantity in Cart
  const updateQty = (uniqueKey, delta) => {
    setCart(cart.map(item => {
      if (item.uniqueKey === uniqueKey) {
        if (item.room_id) {
          sysAlert('กรุณาลบแล้วเพิ่มห้องใหม่หากต้องการแก้ไขระยะชั่วโมงการจอง');
          return item;
        }
        const nextQty = Math.max(1, item.quantity + delta);
        return {
          ...item,
          quantity: nextQty,
          subtotal: nextQty * item.price
        };
      }
      return item;
    }));
  };

  const removeItem = (uniqueKey) => {
    setCart(cart.filter(item => item.uniqueKey !== uniqueKey));
  };

  const calculateTotal = () => {
    return cart.reduce((sum, item) => sum + item.subtotal, 0);
  };

  // Submit checkout to server
  const handleCheckout = async () => {
    const hasRoomInCart = cart.some(item => item.room_id);
    let customerName = customer.name.trim();
    
    if (!customerName) {
      if (hasRoomInCart) {
        sysAlert('กรุณากรอกชื่อผู้จองเพื่อทำรายการจองห้องประชุม');
        return;
      } else {
        customerName = 'ลูกค้าทั่วไป';
      }
    }
    
    if (hasRoomInCart) {
      if (!paymentStatus) {
        sysAlert('กรุณาเลือกสถานะการชำระเงินสำหรับการจองห้องประชุม');
        return;
      }
      if (paymentStatus === 'paid' && !paymentMethod) {
        sysAlert('กรุณาเลือกช่องทางการชำระเงินสำหรับการจองห้องประชุม');
        return;
      }
    }
    
    if (cart.length === 0) {
      sysAlert('กรุณาเลือกรายการในตะกร้าอย่างน้อย 1 รายการ');
      return;
    }

    // Verify overlap check for all rooms in cart before final checkout
    for (const item of cart) {
      if (item.room_id) {
        try {
          const checkRes = await fetch(
            `/api/bookings/check-overlap?room_id=${item.room_id}&start_time=${item.start_time}&end_time=${item.end_time}`
          );
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.overlap) {
              const sTime = new Date(checkData.booking.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
              const eTime = new Date(checkData.booking.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
              sysAlert(
                `⚠️ ไม่สามารถยืนยันการจองได้เนื่องจากมีข้อมูลจองซ้ำ!\n\nห้อง "${item.room_name}" ถูกจองใช้งานไว้ก่อนแล้ว\nผู้เข้าใช้: คุณ ${checkData.booking.customer_name}\nช่วงเวลา: ${sTime} - ${eTime} น.\n\nกรุณาลบรายการห้องนี้ออกจากตะกร้าและเลือกเวลาใหม่`
              );
              return;
            }
          }
        } catch (err) {
          console.error('Failed to run final checkout check:', err);
        }
      }
    }

    const payload = {
      customer_name: customerName,
      department: customer.department,
      contact: customer.contact,
      total_amount: calculateTotal(),
      payment_status: paymentStatus || (hasRoomInCart ? 'pending' : 'paid'),
      payment_method: paymentMethod || 'cash',
      items: cart
    };

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const bookingId = data.bookingId;
        const detailsRes = await fetch(`/api/bookings/${bookingId}`);
        if (detailsRes.ok) {
          const bookingDetails = await detailsRes.json();
          setPrintBooking(bookingDetails);
          setShowReceiptModal(true);
          
          setTimeout(() => {
            window.print();
          }, 600);
        }

        // Reset state & refresh calendar
        setCart([]);
        setCustomer({ name: '', department: '', contact: '' });
        setPaymentStatus('');
        setPaymentMethod('');
        setSelectedDay(null);
        fetchCalendarEvents();
      } else {
        alert('เกิดข้อผิดพลาด: ' + (data.error || 'ไม่สามารถชำระเงินได้'));
      }
    } catch (err) {
      alert('เชื่อมต่อเซิร์ฟเวอร์หลักไม่ได้ กรุณาตรวจสอบการรันเซิร์ฟเวอร์');
    }
  };

  const changeSelectedDay = (offset) => {
    if (!selectedDay) return;
    const current = new Date(selectedDay.year, selectedDay.month, selectedDay.day);
    current.setDate(current.getDate() + offset);
    
    const newMonth = current.getMonth();
    const newYear = current.getFullYear();
    if (newMonth !== calendarMonth || newYear !== calendarYear) {
      setCalendarMonth(newMonth);
      setCalendarYear(newYear);
    }
    
    setSelectedDay({
      day: current.getDate(),
      month: newMonth,
      year: newYear,
      isOtherMonth: false
    });
  };

  const filteredMonthBookings = useMemo(() => {
    const query = monthSearchQuery.toLowerCase();
    return calendarEvents.filter(b => 
      String(b.booking_id).includes(query) ||
      (b.customer_name && b.customer_name.toLowerCase().includes(query)) ||
      (b.room_name && b.room_name.toLowerCase().includes(query))
    );
  }, [calendarEvents, monthSearchQuery]);

  const groupedBookings = useMemo(() => {
    const temp = {};
    filteredMonthBookings.forEach(item => {
      if (!temp[item.booking_id]) {
        temp[item.booking_id] = {
          id: item.booking_id,
          customer_name: item.customer_name,
          payment_status: item.payment_status,
          start_time: item.start_time,
          room_names: [item.room_name],
          subtotal: item.subtotal
        };
      } else {
        if (!temp[item.booking_id].room_names.includes(item.room_name)) {
          temp[item.booking_id].room_names.push(item.room_name);
        }
        temp[item.booking_id].subtotal += item.subtotal;
      }
    });
    return Object.values(temp).sort((a, b) => b.id - a.id); // Newest first
  }, [filteredMonthBookings]);

  const handlePrintReceiptFromList = async (bookingId) => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}`);
      if (res.ok) {
        const data = await res.json();
        setPrintBooking(data);
        setShowReceiptModal(true);
        setTimeout(() => {
          window.print();
        }, 600);
      }
    } catch (err) {
      sysAlert('ไม่สามารถดึงข้อมูลใบเสร็จใบนี้ได้');
    }
  };

  const getModalFilteredItems = () => {
    const roomsFiltered = rooms.map(r => ({ ...r, type: 'room' }));
    const servicesFiltered = services.map(s => ({ ...s, type: 'service' }));

    if (modalCategory === 'all') {
      return [...roomsFiltered, ...servicesFiltered];
    } else if (modalCategory === 'room') {
      return roomsFiltered;
    } else {
      return servicesFiltered.filter(s => s.category === modalCategory);
    }
  };

  // =========================================================
  // RENDER
  // =========================================================
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      <div className="tab-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="tab-title">จองพื้นที่ & บริการเสริม (POS Counter)</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            ผู้ใช้งาน: <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{user.username}</span>
          </div>
          {/* Cart Toggle Icon Button with Red Badge */}
          <button 
            onClick={() => setShowCartSidebar(!showCartSidebar)}
            type="button"
            style={{
              position: 'relative',
              background: showCartSidebar ? 'var(--primary-color)' : 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              color: showCartSidebar ? '#ffffff' : 'var(--text-main)',
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              transition: 'all 0.2s',
              zIndex: 5
            }}
            title="ดูสินค้าในตะกร้า"
          >
            <ShoppingCart size={20} />
            {cart.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '-6px',
                right: '-6px',
                backgroundColor: 'var(--danger-color)',
                color: '#ffffff',
                fontSize: '0.65rem',
                fontWeight: 'bold',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {cart.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="pos-layout" style={{ 
        display: 'grid', 
        gridTemplateColumns: showCartSidebar ? '220px 1fr 380px' : '220px 1fr', 
        gap: '20px', 
        height: 'calc(100vh - 145px)',
        overflow: 'hidden',
        transition: 'grid-template-columns 0.3s ease-in-out'
      }}>
        {/* LEFT COLUMN: Mini Calendar Sidebar & Selected Day History (Liquidglass theme blocks) */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-color)',
          paddingRight: '14px',
          height: '100%',
          overflowY: 'auto',
          gap: '16px'
        }}>
          {/* Block 1: Mini Calendar (Liquidglass card) */}
          <div style={{
            background: 'var(--bg-glass-card, rgba(255, 255, 255, 0.03))',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
            borderRadius: '16px',
            padding: '12px 10px',
            boxShadow: 'var(--glass-shadow, 0 8px 32px rgba(0,0,0,0.1))'
          }}>
            {/* Mini Calendar Month Title */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                {calendarYear} {monthNamesEng[calendarMonth]}
              </span>
              <div style={{ display: 'flex', gap: '2px' }}>
                <button 
                  onClick={goToPrevMonth}
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '2px' }}
                >
                  <ChevronUp size={12} />
                </button>
                <button 
                  onClick={goToNextMonth}
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '2px' }}
                >
                  <ChevronDown size={12} />
                </button>
              </div>
            </div>

            {/* Mini Calendar Weekdays */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: '4px' }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dayChar, i) => (
                <div key={i} style={{ fontSize: '0.6rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>{dayChar}</div>
              ))}
            </div>

            {/* Mini Calendar Cells Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
              {calendarDays.map((dayObj, i) => {
                const dateKey = getDateKey(dayObj.day, dayObj.month, dayObj.year);
                const dayEvents = filteredEventsByDay[dateKey] || [];
                const isSelected = sidebarSelectedDay && sidebarSelectedDay.day === dayObj.day && sidebarSelectedDay.month === dayObj.month && sidebarSelectedDay.year === dayObj.year;
                const isTodayCell = isToday(dayObj.day, dayObj.month, dayObj.year);

                return (
                  <div 
                    key={i}
                    onClick={() => handleMiniDayClick(dayObj)}
                    onDoubleClick={() => {
                      handleMiniDayClick(dayObj);
                      setSelectedDay(dayObj);
                      setIsDayModalOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '20px',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: '50%',
                      color: isTodayCell ? '#ffffff' : (dayObj.isOtherMonth ? 'var(--text-muted)' : 'var(--text-main)'),
                      opacity: dayObj.isOtherMonth ? 0.4 : 1,
                      backgroundColor: isTodayCell ? 'var(--primary-color)' : (isSelected ? 'rgba(56, 189, 248, 0.2)' : 'transparent'),
                      border: isSelected ? '1px solid var(--primary-color)' : 'none',
                      position: 'relative'
                    }}
                  >
                    {dayObj.day}
                    {dayEvents.length > 0 && !isTodayCell && (
                      <div style={{
                        position: 'absolute',
                        bottom: '1px',
                        width: '3px',
                        height: '3px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--primary-color)'
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Block 2: Selected Day Agenda/History (Liquidglass card) */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-glass-card, rgba(255, 255, 255, 0.03))',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
            borderRadius: '16px',
            padding: '14px 12px',
            boxShadow: 'var(--glass-shadow, 0 8px 32px rgba(0,0,0,0.1))',
            minHeight: 0
          }}>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🗓️ ประวัติการจองประจำวัน
            </h3>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              fontSize: '0.7rem', 
              fontWeight: 500, 
              color: 'var(--text-muted)', 
              marginBottom: '12px', 
              borderBottom: '1px solid var(--border-color)', 
              paddingBottom: '8px'
            }}>
              <span>วันที่ {sidebarSelectedDay ? `${sidebarSelectedDay.day} ${monthNames[sidebarSelectedDay.month]} ${sidebarSelectedDay.year + 543}` : ''}</span>
              <span style={{ 
                backgroundColor: 'rgba(56, 189, 248, 0.15)', 
                color: 'var(--primary-color)',
                padding: '2px 8px', 
                borderRadius: '99px',
                fontSize: '0.65rem',
                fontWeight: 'bold',
                whiteSpace: 'nowrap'
              }}>
                ใช้งาน {selectedDayBookings.length} ห้อง
              </span>
            </div>

            {/* List of bookings for the selected day */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0, paddingRight: '2px' }}>
              {selectedDayBookings.length === 0 ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px', fontStyle: 'italic' }}>
                  ไม่มีประวัติการจองห้องในวันนี้
                </div>
              ) : (
                selectedDayBookings.map((ev, idx) => {
                  const startT = new Date(ev.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                  const endT = new Date(ev.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div 
                      key={idx}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '12px',
                        backgroundColor: 'rgba(255, 255, 255, 0.015)',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.78rem',
                        lineHeight: 1.4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.015)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.88rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{ev.room_name}</span>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: 'bold',
                          padding: '2px 6px',
                          borderRadius: '6px',
                          backgroundColor: ev.payment_status === 'paid' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                          color: ev.payment_status === 'paid' ? 'var(--success-color)' : 'var(--warning-color)'
                        }}>
                          {ev.payment_status === 'paid' ? 'จ่ายแล้ว' : 'ค้างชำระ'}
                        </span>
                      </div>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.78rem' }}>🕒 {startT} - {endT}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>ผู้จอง: {ev.customer_name}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Outlook-style Main Calendar Grid */}
        <div className="calendar-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Calendar Navigation Bar (Outlook-style) */}
          <div className="calendar-nav" style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px' }}>
            <button 
              className="calendar-today-btn" 
              onClick={goToToday}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '6px 12px', borderRadius: '6px' }}
            >
              <Calendar size={13} />
              <span>Today</span>
              <ChevronDown size={11} style={{ opacity: 0.5 }} />
            </button>
            <div style={{ display: 'flex', gap: '2px' }}>
              <button className="calendar-nav-btn" onClick={goToPrevMonth} style={{ width: '28px', height: '28px', borderRadius: '6px' }}>
                <ChevronLeft size={14} />
              </button>
              <button className="calendar-nav-btn" onClick={goToNextMonth} style={{ width: '28px', height: '28px', borderRadius: '6px' }}>
                <ChevronRight size={14} />
              </button>
            </div>
            
            <div style={{ position: 'relative' }}>
              <span 
                className="calendar-month-label" 
                onClick={() => setShowMonthSelector(!showMonthSelector)}
                style={{ fontSize: '1.1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}
              >
                {calendarYear} {monthNamesEng[calendarMonth]}
                <ChevronDown size={14} style={{ opacity: 0.5 }} />
              </span>

              {/* FLOATING MONTH-YEAR SELECTOR POPUP (matching screenshot) */}
              {showMonthSelector && (
                <div style={{
                  position: 'absolute',
                  top: '32px',
                  left: '8px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '16px',
                  boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                  width: '240px',
                  zIndex: 150,
                  animation: 'fadeIn 0.15s ease-out'
                }}>
                  {/* Year navigation row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{calendarYear}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => setCalendarYear(calendarYear - 1)}
                        type="button"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '2px' }}
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button 
                        onClick={() => setCalendarYear(calendarYear + 1)}
                        type="button"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '2px' }}
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Months Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((mName, idx) => {
                      const isSel = idx === calendarMonth;
                      return (
                        <button
                          key={mName}
                          onClick={() => {
                            setCalendarMonth(idx);
                            setShowMonthSelector(false);
                            // Also update selectedDay month/year if selectedDay is set
                            if (sidebarSelectedDay) {
                              setSidebarSelectedDay({
                                ...sidebarSelectedDay,
                                month: idx,
                                year: calendarYear
                              });
                            }
                          }}
                          type="button"
                          style={{
                            background: isSel ? 'var(--primary-color)' : 'transparent',
                            color: isSel ? '#ffffff' : 'var(--text-main)',
                            border: 'none',
                            padding: '8px 0',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                          className={!isSel ? 'calendar-nav-btn' : ''}
                        >
                          {mName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="calendar-grid-wrapper" style={{ flex: 1, minHeight: 0 }}>
            {/* Weekday Headers */}
            <div className="calendar-weekday-row">
              {weekdays.map(wd => (
                <div key={wd} className="calendar-weekday-cell">{wd}</div>
              ))}
            </div>

            {/* Day Cells */}
            <div className="calendar-body">
              {calendarDays.map((dayObj, idx) => {
                const dateKey = getDateKey(dayObj.day, dayObj.month, dayObj.year);
                const dayEvents = filteredEventsByDay[dateKey] || [];
                const isTodayCell = isToday(dayObj.day, dayObj.month, dayObj.year);
                const isSelected = sidebarSelectedDay && sidebarSelectedDay.day === dayObj.day && sidebarSelectedDay.month === dayObj.month && sidebarSelectedDay.year === dayObj.year;
                const maxVisible = 3;

                return (
                  <div 
                    key={idx} 
                    className={`calendar-cell ${dayObj.isOtherMonth ? 'other-month' : ''} ${isTodayCell ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      handleDayClick(dayObj);
                      setIsDayModalOpen(true);
                    }}
                  >
                    <div className="calendar-day-number">
                      {dayObj.day}
                    </div>
                    <div className="calendar-events-list">
                      {dayEvents.slice(0, maxVisible).map((ev, i) => {
                        const startT = new Date(ev.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                        const endT = new Date(ev.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                        const isDaily = ev.quantity === 1 && ev.price >= 1000;
                        const has301 = ev.room_name && ev.room_name.includes('301');
                        
                        const layoutText = has301 ? (ev.layout === 'classroom' ? ' (Classroom)' : ' (Standard)') : '';
                        const typeText = isDaily ? ' [รายวัน]' : ' [รายชม.]';
                        
                        const fullTitle = `${ev.room_name}${layoutText}${typeText} | เวลา ${startT} - ${endT} น. | ผู้จอง: ${ev.customer_name}`;
                        
                        const displayLayoutChip = has301 ? (ev.layout === 'classroom' ? '(CR)' : '(Std)') : '';
                        const displayChipText = `${ev.room_name}${displayLayoutChip}${isDaily ? '[วัน]' : '[ชม.]'} ${startT}-${endT} • ${ev.customer_name}`;

                        return (
                          <div 
                            key={i} 
                            className={`calendar-event-chip ${ev.payment_status}`}
                            title={fullTitle}
                          >
                            {displayChipText}
                          </div>
                        );
                      })}

                      {dayEvents.length > maxVisible && (
                        <div className="calendar-more-label">+{dayEvents.length - maxVisible} รายการ</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Cart & Checkout Panel (conditionally displayed based on showCartSidebar state) */}
        {showCartSidebar && (
          <div className="pos-cart-panel" style={{
            animation: 'slideIn 0.3s forwards',
            height: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <ShoppingCart size={22} className="text-primary" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>รายการสินค้าในตะกร้า</h2>
            </div>

            {/* Cart Items List */}
            <div className="cart-items-list">
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '48px' }}>
                  <p style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🗓️</p>
                  <p style={{ fontSize: '0.9rem' }}>คลิกวันบนปฏิทินเพื่อจองห้องประชุม</p>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.uniqueKey} className="cart-item">
                    <div className="cart-item-details">
                      <span className="cart-item-name">
                        {item.room_id 
                          ? (item.room_name && item.room_name.includes('301')
                              ? `${item.room_name} (${item.layout === 'classroom' ? 'Classroom' : 'Standard'})`
                              : item.room_name)
                          : item.service_name}
                      </span>

                      {item.room_id ? (
                        <span className="cart-item-meta">
                          📅 {new Date(item.start_time).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })} ({new Date(item.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} - {new Date(item.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })})
                          {item.booking_type === 'daily' && <span style={{ color: '#f59e0b', fontWeight: 'bold', marginLeft: '6px' }}>[เต็มวัน]</span>}
                        </span>
                      ) : (
                        <span className="cart-item-meta">ราคาชิ้นละ: {item.price}.-</span>
                      )}
                      <div className="cart-item-actions">
                        {!item.room_id && (
                          <>
                            <button className="cart-qty-btn" onClick={() => updateQty(item.uniqueKey, -1)}><Minus size={12} /></button>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{item.quantity}</span>
                            <button className="cart-qty-btn" onClick={() => updateQty(item.uniqueKey, 1)}><Plus size={12} /></button>
                          </>
                        )}
                        <button 
                          style={{ background: 'transparent', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', marginLeft: item.room_id ? '0' : '12px' }}
                          onClick={() => removeItem(item.uniqueKey)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="cart-item-subtotal">
                      {item.subtotal.toLocaleString()}.-
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Summary & Checkout */}
            <div className="cart-summary" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <div className="cart-summary-row">
                <span style={{ color: 'var(--text-muted)' }}>จำนวนรายการทั้งหมด</span>
                <span>{cart.reduce((sum, item) => sum + (item.room_id ? 1 : item.quantity), 0)} รายการ</span>
              </div>
              <div className="cart-summary-row cart-total-row">
                <span>ยอดชำระสุทธิ</span>
                <span>{calculateTotal().toLocaleString()} บาท</span>
              </div>

              <button 
                className="btn btn-primary" 
                style={{ width: '100%', marginTop: '12px', padding: '14px', gap: '8px', fontSize: '1.05rem', borderRadius: 'var(--border-radius)' }}
                onClick={handleCheckout}
              >
                <Check size={20} />
                ยืนยัน
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* DAY DETAIL MODAL (opened when clicking a calendar day)     */}
      {/* ========================================================= */}
      {isDayModalOpen && selectedDay && !selectedRoom && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card" style={{ 
            width: '95%', 
            maxWidth: '650px', 
            height: '580px',
            padding: '24px', 
            backgroundColor: 'var(--bg-glass-modal, rgba(255, 255, 255, 0.94))', 
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.18))',
            display: 'flex', 
            flexDirection: 'column', 
            gap: '16px', 
            borderRadius: '24px', 
            boxShadow: '0 24px 70px rgba(0,0,0,0.25)',
            overflow: 'hidden'
          }}>
            {/* Header with Day Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button 
                  onClick={() => changeSelectedDay(-1)}
                  type="button"
                  style={{
                    background: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  className="calendar-nav-btn"
                >
                  <ChevronLeft size={16} />
                </button>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-main)', minWidth: '260px', textAlign: 'center' }}>
                  📅 จัดการจอง: {selectedDay.day} {monthNames[selectedDay.month]} {selectedDay.year + 543}
                </h2>
                <button 
                  onClick={() => changeSelectedDay(1)}
                  type="button"
                  style={{
                    background: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  className="calendar-nav-btn"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setIsDayModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            {/* Single Column Layout (Removed Left Column History) */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
              
              {/* Product/Service Catalog */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, overflow: 'hidden' }}>
                
                {/* Category selectors (Tabs) */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                  <button 
                    onClick={() => setModalCategory('all')}
                    type="button"
                    style={{
                      padding: '6px 12px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border-color)',
                      backgroundColor: modalCategory === 'all' ? 'var(--primary-color)' : 'var(--bg-color)',
                      color: modalCategory === 'all' ? '#ffffff' : 'var(--text-muted)'
                    }}
                  >ทั้งหมด</button>
                  <button 
                    onClick={() => setModalCategory('room')}
                    type="button"
                    style={{
                      padding: '6px 12px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border-color)',
                      backgroundColor: modalCategory === 'room' ? 'var(--primary-color)' : 'var(--bg-color)',
                      color: modalCategory === 'room' ? '#ffffff' : 'var(--text-muted)'
                    }}
                  >ห้องประชุม</button>
                  <button 
                    onClick={() => setModalCategory('Co-Working')}
                    type="button"
                    style={{
                      padding: '6px 12px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border-color)',
                      backgroundColor: modalCategory === 'Co-Working' ? 'var(--primary-color)' : 'var(--bg-color)',
                      color: modalCategory === 'Co-Working' ? '#ffffff' : 'var(--text-muted)'
                    }}
                  >Co-Working</button>
                  <button 
                    onClick={() => setModalCategory('Koocafe')}
                    type="button"
                    style={{
                      padding: '6px 12px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border-color)',
                      backgroundColor: modalCategory === 'Koocafe' ? 'var(--primary-color)' : 'var(--bg-color)',
                      color: modalCategory === 'Koocafe' ? '#ffffff' : 'var(--text-muted)'
                    }}
                  >Koocafe</button>
                  <button 
                    onClick={() => setModalCategory('Parking')}
                    type="button"
                    style={{
                      padding: '6px 12px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border-color)',
                      backgroundColor: modalCategory === 'Parking' ? 'var(--primary-color)' : 'var(--bg-color)',
                      color: modalCategory === 'Parking' ? '#ffffff' : 'var(--text-muted)'
                    }}
                  >ที่จอดรถ</button>
                </div>

                {/* Items Catalog Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px', overflowY: 'auto', flex: 1, padding: '4px' }}>
                  {getModalFilteredItems().map(item => (
                    <div 
                      key={`${item.type}-${item.id}`}
                      className="pos-item-card"
                      style={{ height: 'auto', minHeight: '120px', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '8px' }}
                      onClick={() => item.type === 'room' ? openRoomModalFromDay(item) : addServiceToCartDirect(item)}
                    >
                      <div className="pos-item-info" style={{ gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '4px' }}>
                          <span className="pos-item-title" style={{ fontSize: '0.85rem' }}>{item.name}</span>
                          <span className={`badge ${item.type === 'room' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                            {item.type === 'room' ? 'ห้อง' : 'บริการ'}
                          </span>
                        </div>
                        {item.type === 'room' ? (
                          <p className="pos-item-desc" style={{ fontSize: '0.7rem', margin: 0 }}>ความจุ {item.capacity} คน</p>
                        ) : (
                          <p className="pos-item-desc" style={{ fontSize: '0.7rem', margin: 0 }}>{item.category}</p>
                        )}
                      </div>
                      <div className="pos-item-footer" style={{ marginTop: '4px' }}>
                        <span className="pos-item-price" style={{ fontSize: '0.95rem' }}>
                          {item.type === 'room' ? `${item.hourly_rate}.-/ชม.` : `${item.price}.-`}
                        </span>
                        <div style={{ 
                          backgroundColor: 'var(--primary-light)', 
                          color: 'var(--primary-color)',
                          width: '26px', height: '26px', borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 'bold', fontSize: '0.8rem'
                        }}>+</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ROOM SCHEDULE CONFIGURATION MODAL                          */}
      {/* ========================================================= */}
      {selectedRoom && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 120
        }}>
          <div className="card" style={{ width: '95%', maxWidth: '480px', padding: '24px', backgroundColor: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: '16px', borderRadius: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>🗓️ จองพื้นที่: {selectedRoom.name}</h2>
              <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setSelectedRoom(null)}>
                <X size={20} />
              </button>
            </div>

            {/* Booking Type Toggle */}
            <div style={{ display: 'flex', gap: '0', borderRadius: '14px', overflow: 'hidden', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)' }}>
              <button
                style={{
                  flex: 1, padding: '10px 16px', border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.85rem', transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  backgroundColor: bookingType === 'hourly' ? 'var(--primary-color)' : 'transparent',
                  color: bookingType === 'hourly' ? '#fff' : 'var(--text-muted)',
                }}
                onClick={() => setBookingType('hourly')}
              >
                <Clock size={15} />
                รายชั่วโมง
              </button>
              <button
                style={{
                  flex: 1, padding: '10px 16px', border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.85rem', transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  backgroundColor: bookingType === 'daily' ? '#f59e0b' : 'transparent',
                  color: bookingType === 'daily' ? '#fff' : 'var(--text-muted)',
                  opacity: (layoutType === 'classroom' ? selectedRoom.classroom_daily_rate > 0 : selectedRoom.daily_rate > 0) ? 1 : 0.4,
                }}
                onClick={() => {
                  const hasDaily = layoutType === 'classroom' ? (selectedRoom.classroom_daily_rate > 0) : (selectedRoom.daily_rate > 0);
                  if (hasDaily) {
                    setBookingType('daily');
                  } else {
                    sysAlert('ห้องนี้ในรูปแบบที่เลือกยังไม่ได้ตั้งค่าราคารายวัน\nกรุณาตั้งค่าในหน้า "จัดการคลัง" ก่อน');
                  }
                }}
              >
                <Calendar size={15} />
                รายวัน (ทั้งวัน)
              </button>
            </div>

            {/* Room Layout Toggle (Standard vs Classroom) - Only if supports classroom! */}
            {selectedRoom.has_classroom === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 600 }}>รูปแบบการจัดห้อง (Layout)</label>
                <div style={{ display: 'flex', gap: '0', borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(236, 72, 153, 0.2)', backgroundColor: 'var(--bg-color)' }}>
                  <button
                    style={{
                      flex: 1, padding: '8px 12px', border: 'none', cursor: 'pointer',
                      fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s ease',
                      backgroundColor: layoutType === 'standard' ? 'var(--primary-color)' : 'transparent',
                      color: layoutType === 'standard' ? '#fff' : 'var(--text-muted)',
                    }}
                    onClick={() => {
                      setLayoutType('standard');
                      if (bookingType === 'daily' && !(selectedRoom.daily_rate > 0)) {
                        setBookingType('hourly');
                      }
                    }}
                  >
                    Standard ({selectedRoom.capacity} ที่นั่ง)
                  </button>
                  <button
                    style={{
                      flex: 1, padding: '8px 12px', border: 'none', cursor: 'pointer',
                      fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s ease',
                      backgroundColor: layoutType === 'classroom' ? '#ec4899' : 'transparent',
                      color: layoutType === 'classroom' ? '#fff' : 'var(--text-muted)',
                    }}
                    onClick={() => {
                      setLayoutType('classroom');
                      if (bookingType === 'daily' && !(selectedRoom.classroom_daily_rate > 0)) {
                        setBookingType('hourly');
                      }
                    }}
                  >
                    Classroom ({selectedRoom.classroom_capacity} ที่นั่ง)
                  </button>
                </div>
              </div>
            )}

            {/* Row 1: Date & Time */}
            <div className="grid-cols-2" style={{ gap: '16px' }}>
              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 600 }}>
                  วันที่ทำการจอง <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span>
                </label>
                <CustomDatePicker
                  value={roomSchedule.date}
                  onChange={val => setRoomSchedule({ ...roomSchedule, date: val })}
                  className="form-control"
                  style={{ display: 'flex', alignItems: 'center', height: '40px', padding: '8px 12px', cursor: 'pointer', backgroundColor: 'var(--bg-color)', borderRadius: '12px' }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 600 }}>
                  {bookingType === 'daily' ? 'ช่วงเวลาประจำวัน' : 'ช่วงเวลาใช้งาน'} <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span>
                </label>

                {bookingType === 'daily' ? (
                  /* Daily: Dropdown time slot selector */
                  <select
                    className="form-control"
                    style={{ padding: '8px 12px', height: '40px', borderRadius: '12px', fontWeight: 600, fontSize: '0.9rem' }}
                    value={dailyTimeSlot}
                    onChange={e => setDailyTimeSlot(e.target.value)}
                  >
                    <option value="08-17">08:00 - 17:00 น.</option>
                    <option value="09-18">09:00 - 18:00 น.</option>
                  </select>
                ) : (
                  /* Hourly: Manual time input */
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '40px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '4px 6px', backgroundColor: 'var(--bg-color)', height: '40px', width: '90px' }}>
                      <input 
                        type="text" placeholder="HH" maxLength={2}
                        style={{ border: 'none', background: 'transparent', textAlign: 'center', width: '22px', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 'bold', outline: 'none' }}
                        value={roomSchedule.startHour || ''}
                        onChange={e => setRoomSchedule({ ...roomSchedule, startHour: e.target.value.replace(/\D/g, '') })}
                      />
                      <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>:</span>
                      <input 
                        type="text" placeholder="MM" maxLength={2}
                        style={{ border: 'none', background: 'transparent', textAlign: 'center', width: '22px', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 'bold', outline: 'none' }}
                        value={roomSchedule.startMinute || ''}
                        onChange={e => setRoomSchedule({ ...roomSchedule, startMinute: e.target.value.replace(/\D/g, '') })}
                      />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>ถึง</span>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '4px 6px', backgroundColor: 'var(--bg-color)', height: '40px', width: '90px' }}>
                      <input 
                        type="text" placeholder="HH" maxLength={2}
                        style={{ border: 'none', background: 'transparent', textAlign: 'center', width: '22px', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 'bold', outline: 'none' }}
                        value={roomSchedule.endHour || ''}
                        onChange={e => setRoomSchedule({ ...roomSchedule, endHour: e.target.value.replace(/\D/g, '') })}
                      />
                      <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>:</span>
                      <input 
                        type="text" placeholder="MM" maxLength={2}
                        style={{ border: 'none', background: 'transparent', textAlign: 'center', width: '22px', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 'bold', outline: 'none' }}
                        value={roomSchedule.endMinute || ''}
                        onChange={e => setRoomSchedule({ ...roomSchedule, endMinute: e.target.value.replace(/\D/g, '') })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Row 2: Customer Name & Contact */}
            <div className="grid-cols-2" style={{ gap: '16px' }}>
              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 600 }}>
                  ชื่อผู้จอง <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '4px 10px', backgroundColor: 'var(--bg-color)', height: '40px' }}>
                  <User size={15} style={{ color: 'var(--text-muted)' }} />
                  <input 
                    type="text" className="form-control" 
                    style={{ border: 'none', background: 'transparent', padding: '6px 0', width: '100%', outline: 'none', boxShadow: 'none' }}
                    placeholder="กรอกชื่อผู้จอง"
                    value={customer.name}
                    onChange={e => setCustomer({ ...customer, name: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 600 }}>เบอร์ติดต่อ</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '4px 10px', backgroundColor: 'var(--bg-color)', height: '40px' }}>
                  <Phone size={15} style={{ color: 'var(--text-muted)' }} />
                  <input 
                    type="text" className="form-control" 
                    style={{ border: 'none', background: 'transparent', padding: '6px 0', width: '100%', outline: 'none', boxShadow: 'none' }}
                    placeholder="กรอกเบอร์โทรศัพท์"
                    value={customer.contact}
                    onChange={e => setCustomer({ ...customer, contact: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Row 3: Payment Status & Method */}
            <div style={{ display: 'grid', gridTemplateColumns: paymentStatus === 'paid' ? '1fr 1fr' : '1fr', gap: '16px' }}>
              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 600 }}>สถานะการชำระเงิน <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                <select 
                  className="form-control" 
                  style={{ padding: '8px 12px', height: '40px', borderRadius: '12px' }} 
                  value={paymentStatus} 
                  onChange={e => {
                    const val = e.target.value;
                    setPaymentStatus(val);
                    if (val === 'pending') {
                      setPaymentMethod(''); // Clear payment method for pending bookings
                    }
                  }}
                >
                  <option value="">ยังไม่เลือก</option>
                  <option value="paid">ชำระเงินแล้ว</option>
                  <option value="pending">ค้างชำระ (Pending)</option>
                </select>
              </div>

              {paymentStatus === 'paid' && (
                <div className="form-group">
                  <label style={{ fontSize: '0.825rem', fontWeight: 600 }}>ช่องทางการชำระเงิน <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                  <select 
                    className="form-control" 
                    style={{ padding: '8px 12px', height: '40px', borderRadius: '12px' }} 
                    value={paymentMethod} 
                    onChange={e => setPaymentMethod(e.target.value)}
                  >
                    <option value="">ยังไม่เลือก</option>
                    <option value="cash">เงินสด (Cash)</option>
                    <option value="transfer">โอนเงินเข้าบัญชี</option>
                  </select>
                </div>
              )}
            </div>

            {/* Rate info summary */}
            <div style={{ 
              fontSize: '0.825rem', 
              padding: '10px 14px', 
              borderRadius: '12px', 
              backgroundColor: bookingType === 'daily' ? 'rgba(245, 158, 11, 0.08)' : 'rgba(99, 102, 241, 0.08)',
              border: `1px solid ${bookingType === 'daily' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(99, 102, 241, 0.15)'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {bookingType === 'daily' ? (
                <>
                  <Calendar size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-main)' }}>
                    <strong style={{ color: '#f59e0b' }}>รายวัน ({layoutType === 'classroom' ? 'Classroom' : 'Standard'})</strong> — อัตราค่าบริการ <strong>{Number(layoutType === 'classroom' ? selectedRoom.classroom_daily_rate || 0 : selectedRoom.daily_rate || 0).toLocaleString()}</strong> บาท / วัน
                    {dailyTimeSlot === '08-17' ? ' (08:00 - 17:00 น.)' : ' (09:00 - 18:00 น.)'}
                  </span>
                </>
              ) : (
                <>
                  <Clock size={14} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-main)' }}>
                    <strong style={{ color: 'var(--primary-color)' }}>รายชั่วโมง ({layoutType === 'classroom' ? 'Classroom' : 'Standard'})</strong> — อัตราค่าบริการ <strong>{Number(layoutType === 'classroom' ? selectedRoom.classroom_hourly_rate || 0 : selectedRoom.hourly_rate || 0).toLocaleString()}</strong> บาท / ชม. (เศษชั่วโมงปัดขึ้น)
                  </span>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
              <button className="btn btn-secondary" style={{ flex: 1, borderRadius: '12px' }} onClick={() => setSelectedRoom(null)}>ยกเลิก</button>
              <button className="btn btn-primary" style={{ flex: 2, borderRadius: '12px' }} onClick={addRoomToCart}>เพิ่มลงตะกร้า</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* RECEIPT PRINT MODAL                                        */}
      {/* ========================================================= */}
      {showReceiptModal && printBooking && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200,
          overflowY: 'auto',
          padding: '20px'
        }} className="print-modal-overlay">
          <div style={{ backgroundColor: 'var(--bg-card)', padding: '16px', borderRadius: 'var(--border-radius)', marginBottom: '16px', display: 'flex', gap: '8px', width: '100%', maxWidth: '380px', flexWrap: 'wrap' }} className="no-print">
            <button className="btn btn-secondary" style={{ flex: '1 1 120px', fontSize: '0.85rem', padding: '10px 12px' }} onClick={handleCloseReceiptModal}>ปิดหน้าต่าง</button>
            <button className="btn btn-primary" style={{ flex: '2 1 160px', fontSize: '0.85rem', padding: '10px 12px', gap: '6px' }} onClick={() => window.print()}>
              <Printer size={16} /> พิมพ์ใบเสร็จ
            </button>
          </div>
          <ReceiptPrint booking={printBooking} settings={settings} />
        </div>
      )}
    </div>
  );
}

export default BookingPOS;
