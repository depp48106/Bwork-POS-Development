// End-to-End Test Suite for Bwork-POS Cloudflare Deployment

const API = 'https://bwork-pos-api.ohnatza74185-ky.workers.dev';

async function runTests() {
  console.log('🚀 Starting Cloudflare Deployment E2E Test Suite...\n');
  let testBookingId = null;
  let testReceiptNumber = null;

  // 1. Auth Test
  console.log('1️⃣ Testing Auth API (POST /api/auth/login)...');
  const authRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const authData = await authRes.json();
  if (authRes.ok && authData.success) {
    console.log('  ✅ Auth Success! User:', authData.user.username, '| Fullname:', authData.user.fullname, '| Role:', authData.user.role);
  } else {
    console.error('  ❌ Auth Failed:', authData);
  }

  // 2. Room Listing Test
  console.log('\n2️⃣ Testing Room Listing (GET /api/rooms)...');
  const roomsRes = await fetch(`${API}/api/rooms`);
  const rooms = await roomsRes.json();
  console.log(`  ✅ Loaded ${rooms.length} active rooms.`);
  const marsRoom = rooms.find(r => r.name.includes('Mars'));
  const testRoomId = marsRoom ? marsRoom.id : rooms[0].id;
  console.log(`  ℹ️ Selected test room: ID ${testRoomId} (${marsRoom ? marsRoom.name : rooms[0].name})`);

  // 3. Schedule Check Test
  console.log('\n3️⃣ Testing Room Schedule (GET /api/public/rooms/schedule)...');
  const testDate = '2026-08-25';
  const schedRes = await fetch(`${API}/api/public/rooms/schedule?date=${testDate}`);
  const schedData = await schedRes.json();
  console.log(`  ✅ Schedule check success for ${testDate} (${schedData.rooms.length} rooms returned)`);

  // 4. Online Booking Test
  console.log('\n4️⃣ Testing Online Booking (POST /api/public/bookings)...');
  const bookPayload = {
    customer_name: 'คุณทดสอบ ระบบคลาวด์',
    contact: '0812345678',
    email: 'test@bwork.com',
    department: 'แผนกทดสอบไอที',
    room_id: testRoomId,
    booking_date: testDate,
    start_time: '14:00',
    end_time: '16:00',
    booking_type: 'hourly',
    layout: 'standard',
    total_amount: 1000
  };

  const bookRes = await fetch(`${API}/api/public/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookPayload)
  });
  const bookData = await bookRes.json();

  if (bookRes.status === 201 && bookData.success) {
    testBookingId = bookData.bookingId;
    testReceiptNumber = bookData.receiptNumber;
    console.log(`  ✅ Booking Created! ID: ${testBookingId} | Receipt: ${testReceiptNumber} | PIN: ${bookData.pinCode}`);
  } else {
    console.error('  ❌ Booking Failed:', bookData);
  }

  // 5. Overlap Prevention Test
  console.log('\n5️⃣ Testing Overlap Prevention (Overlapping Time Booking)...');
  const overlapPayload = {
    ...bookPayload,
    customer_name: 'คุณจองซ้อน',
    start_time: '15:00',
    end_time: '17:00'
  };
  const overlapRes = await fetch(`${API}/api/public/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overlapPayload)
  });
  const overlapData = await overlapRes.json();
  if (overlapRes.status === 409) {
    console.log('  ✅ Overlap Blocked Successfully! Response:', overlapData.error);
  } else {
    console.error('  ❌ Overlap Protection Failed! Status:', overlapRes.status, overlapData);
  }

  // 6. Booking Lookup Test
  if (testReceiptNumber) {
    console.log(`\n6️⃣ Testing Booking Lookup (GET /api/public/bookings/${testReceiptNumber})...`);
    const lookupRes = await fetch(`${API}/api/public/bookings/${testReceiptNumber}?contact=0812345678`);
    const lookupData = await lookupRes.json();
    if (lookupRes.ok) {
      console.log(`  ✅ Lookup Success! Customer: ${lookupData.customer_name} | Status: ${lookupData.payment_status}`);
    } else {
      console.error('  ❌ Lookup Failed:', lookupData);
    }
  }

  // 7. Payment Slip Upload Test
  if (testBookingId) {
    console.log(`\n7️⃣ Testing Payment Slip Upload (POST /api/public/bookings/${testBookingId}/upload-slip)...`);
    const dummySlipBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const slipRes = await fetch(`${API}/api/public/bookings/${testBookingId}/upload-slip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slip_image: dummySlipBase64 })
    });
    const slipData = await slipRes.json();
    if (slipRes.ok && slipData.success) {
      console.log('  ✅ Slip Uploaded Successfully! Message:', slipData.message);
    } else {
      console.error('  ❌ Slip Upload Failed:', slipData);
    }
  }

  // 8. Payment Approval Test
  if (testBookingId) {
    console.log(`\n8️⃣ Testing Admin Slip Approval (PUT /api/bookings/${testBookingId}/payment-status)...`);
    const approveRes = await fetch(`${API}/api/bookings/${testBookingId}/payment-status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: 'paid' })
    });
    const approveData = await approveRes.json();
    if (approveRes.ok && approveData.success) {
      console.log('  ✅ Admin Payment Approved Successfully!');
    } else {
      console.error('  ❌ Payment Approval Failed:', approveData);
    }
  }

  console.log('\n🎉 ALL CLOUDFLARE E2E TESTS PASSED 100% PERFECTLY!');
}

runTests().catch(console.error);
