const fs = require('fs');

async function run() {
  console.log('=== BWORK-POS PRODUCTION POST-DEPLOYMENT SMOKE TESTS ===\n');

  console.log('--- 1. Worker API Health (/api/rooms) ---');
  const roomsRes = await fetch('https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms');
  console.log('Status:', roomsRes.status);
  if (roomsRes.status !== 200) throw new Error('Worker API returned ' + roomsRes.status);
  const rooms = await roomsRes.json();
  console.log('Room count:', rooms.length);
  const sample = rooms[0];
  console.log('Sample room ID:', sample.id, 'Name:', sample.name, 'wifi_username:', sample.wifi_username, 'has_wifi_credentials:', sample.has_wifi_credentials);
  const passwordExposed = rooms.some(r => r.wifi_password || r.wifi_password_enc);
  console.log('Sensitive wifi passwords exposed:', passwordExposed);
  if (passwordExposed) throw new Error('Sensitive wifi password exposed in public API!');

  console.log('\n--- 2. Production POS Pages (bwork-pos.pages.dev) ---');
  const posRes = await fetch('https://bwork-pos.pages.dev');
  console.log('Status:', posRes.status);
  const posHtml = await posRes.text();
  console.log('HTML length:', posHtml.length, 'Contains root element:', posHtml.includes('id="root"'));
  if (posRes.status !== 200 || !posHtml.includes('id="root"')) throw new Error('POS Pages load failed');

  console.log('\n--- 3. Production Booking Pages (bwork-booking.pages.dev) ---');
  const bookingRes = await fetch('https://bwork-booking.pages.dev');
  console.log('Status:', bookingRes.status);
  const bookingHtml = await bookingRes.text();
  console.log('HTML length:', bookingHtml.length, 'Contains root element:', bookingHtml.includes('id="root"'));
  if (bookingRes.status !== 200 || !bookingHtml.includes('id="root"')) throw new Error('Booking Pages load failed');

  console.log('\n--- 4. Online Promotion State (/api/public/promotion) ---');
  const promoRes = await fetch('https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/public/promotion');
  console.log('Status:', promoRes.status);
  const promo = await promoRes.json();
  console.log('Promotion active:', promo.is_active);
  console.log('Promotion discount:', promo.discount_value, promo.discount_type);
  console.log('Promotion start_at:', promo.start_at);
  if (promo.is_active !== false) throw new Error('ONLINE_5_PERCENT was unexpectedly activated!');

  console.log('\n--- 5. Payment Settings (/api/public/settings/payment) ---');
  const payRes = await fetch('https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/public/settings/payment');
  console.log('Status:', payRes.status);
  const pay = await payRes.json();
  console.log('Company:', pay.company_name);
  console.log('PromptPay:', pay.promptpay_id);
  console.log('Deadline hours:', pay.payment_deadline_hours);

  console.log('\n--- 6. Protected Wi-Fi Admin Endpoint Authorization ---');
  const wifiRes = await fetch('https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms/4/wifi');
  console.log('/api/rooms/4/wifi unauthenticated status:', wifiRes.status);
  if (wifiRes.status !== 401) throw new Error('Unauthenticated room wifi request did not return 401');

  console.log('\n--- 7. Protected Wi-Fi Card Endpoint Authorization ---');
  const cardRes = await fetch('https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/bookings/1/wifi-card');
  console.log('/api/bookings/1/wifi-card unauthenticated status:', cardRes.status);
  if (cardRes.status !== 401) throw new Error('Unauthenticated wifi-card request did not return 401');

  console.log('\n--- 8. Pages /api/* Routing Verification ---');
  const posProxyRes = await fetch('https://bwork-pos.pages.dev/api/rooms');
  console.log('bwork-pos.pages.dev/api/rooms status:', posProxyRes.status);
  const posProxyRooms = await posProxyRes.json();
  console.log('bwork-pos proxy room count:', posProxyRooms.length);
  if (posProxyRes.status !== 200 || posProxyRooms.length !== 10) throw new Error('POS /api/rooms routing failed');

  const bookingProxyRes = await fetch('https://bwork-booking.pages.dev/api/rooms');
  console.log('bwork-booking.pages.dev/api/rooms status:', bookingProxyRes.status);
  const bookingProxyRooms = await bookingProxyRes.json();
  console.log('bwork-booking proxy room count:', bookingProxyRooms.length);
  if (bookingProxyRes.status !== 200 || bookingProxyRooms.length !== 10) throw new Error('Booking /api/rooms routing failed');

  console.log('\n=== ALL POST-DEPLOYMENT SMOKE CHECKS PASSED PERFECTLY ===');
}

run().catch(err => {
  console.error('\nFAILED SMOKE CHECK:', err);
  process.exit(1);
});
