<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ระบบสร้างใบเสนอราคาออนไลน์ - BUILT HEART / B-WORK</title>
  
  <!-- Google Fonts: Prompt (Thai) & Inter (English/Numbers) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Prompt:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Prompt', 'Inter', 'sans-serif'],
            mono: ['Inter', 'monospace']
          },
          colors: {
            brand: {
              orange: '#EA580C',
              amber: '#F59E0B',
              navy: '#0F172A',
              slate: '#334155',
              emerald: '#10B981',
              red: '#DC2626'
            }
          },
          boxShadow: {
            'a4': '0 20px 50px -12px rgba(15, 23, 42, 0.12), 0 4px 20px -2px rgba(15, 23, 42, 0.05)',
            'floating': '0 10px 30px -5px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8)'
          }
        }
      }
    }
  </script>

  <!-- Lucide Icons CDN -->
  <script src="https://unpkg.com/lucide@latest"></script>

  <style>
    /* Custom Scrollbars */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f1f5f9; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

    /* A4 Paper Dimensions for Screen View */
    .a4-canvas {
      width: 100%;
      max-width: 860px;
      min-height: 1180px;
      background: #ffffff;
      box-sizing: border-box;
    }

    /* Inline editable field style */
    .editable-cell:focus {
      outline: 2px solid #ea580c;
      background-color: #fff7ed;
      border-radius: 4px;
    }

    /* Print Styles */
    @media print {
      body {
        background: #ffffff !important;
        padding: 0 !important;
        margin: 0 !important;
        color: #000000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print {
        display: none !important;
      }
      .a4-canvas {
        max-width: 100% !important;
        width: 100% !important;
        min-height: auto !important;
        box-shadow: none !important;
        border: none !important;
        margin: 0 !important;
        padding: 10mm 12mm !important;
      }
      @page {
        size: A4 portrait;
        margin: 0;
      }
    }

    /* Pulse animation */
    @keyframes pulse-subtle {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(0.95); }
    }
    .pulse-dot {
      animation: pulse-subtle 2s infinite ease-in-out;
    }
  </style>
</head>

<body class="bg-slate-100 text-slate-800 font-sans antialiased min-h-screen flex flex-col justify-between selection:bg-orange-500 selection:text-white">

  <!-- ========================================================================= -->
  <!-- 1. TOP FLOATING ACTION BAR (Sticky Toolbar)                               -->
  <!-- ========================================================================= -->
  <header class="no-print sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm transition-all">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
      
      <!-- Left: Status & Autosave -->
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-700">
          <span class="w-2 h-2 rounded-full bg-emerald-500 pulse-dot"></span>
          <span>ร่างเอกสาร (Draft)</span>
          <span class="text-slate-300">|</span>
          <span id="headerQuoteNo" class="font-mono text-orange-600 font-bold">QT2026080001</span>
        </div>
        <div class="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
          <i data-lucide="cloud-check" class="w-3.5 h-3.5 text-emerald-500"></i>
          <span id="saveStatusText">บันทึกอัตโนมัติล่าสุดเมื่อสักครู่</span>
        </div>
      </div>

      <!-- Right: Action Buttons -->
      <div class="flex items-center gap-2 sm:gap-3">
        <!-- Quick Load Sample Data -->
        <button onclick="loadSampleData()" type="button" class="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors" title="โหลดข้อมูลตัวอย่าง">
          <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-500"></i>
          <span>ตัวอย่างตัวเลข</span>
        </button>

        <!-- Copy Link -->
        <button onclick="copyDocumentLink()" type="button" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition-colors">
          <i data-lucide="link-2" class="w-3.5 h-3.5 text-slate-500"></i>
          <span class="hidden sm:inline">คัดลอกลิงก์</span>
        </button>

        <!-- Print Preview -->
        <button onclick="triggerPrint()" type="button" class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition-colors">
          <i data-lucide="printer" class="w-3.5 h-3.5 text-slate-600"></i>
          <span>พิมพ์ / PDF</span>
        </button>

        <!-- Save Button -->
        <button onclick="saveQuotation()" type="button" class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-lg shadow-sm shadow-emerald-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]">
          <i data-lucide="check" class="w-4 h-4"></i>
          <span>บันทึกใบเสนอราคา</span>
        </button>
      </div>

    </div>
  </header>

  <!-- ========================================================================= -->
  <!-- MAIN WORKSPACE: A4 DOCUMENT CANVAS                                       -->
  <!-- ========================================================================= -->
  <main class="flex-1 py-6 sm:py-10 px-2 sm:px-4 flex justify-center items-start">
    
    <div id="quotationCanvas" class="a4-canvas rounded-2xl sm:rounded-xl shadow-a4 border border-slate-200/80 p-6 sm:p-10 flex flex-col justify-between relative transition-all">
      
      <!-- TOP DECORATIVE ACCENT BAR -->
      <div class="h-2 w-full bg-gradient-to-r from-orange-600 via-amber-500 to-orange-500 rounded-full mb-8"></div>

      <!-- ===================================================================== -->
      <!-- SECTION A: HEADER & METADATA                                          -->
      <!-- ===================================================================== -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-8 mb-8 pb-8 border-b border-slate-200">
        
        <!-- Left 7 Cols: Dual Logos & Company Info -->
        <div class="md:col-span-7 flex flex-col justify-between">
          <div>
            <!-- Dual Logos: BUILT HEART + B-WORK -->
            <div class="flex items-center gap-4 mb-4">
              <!-- BUILT HEART LOGO BADGE -->
              <div class="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 shadow-sm">
                <span class="w-2.5 h-2.5 rounded-full bg-red-600"></span>
                <span class="font-extrabold text-white text-sm tracking-wider font-mono">BUILT HEART</span>
              </div>
              <span class="text-slate-300 font-light text-xl">|</span>
              <!-- B-WORK LOGO -->
              <div class="flex items-center gap-1.5">
                <span class="font-black text-xl text-orange-600 tracking-tighter">B-WORK</span>
                <span class="text-[10px] font-bold text-slate-500 tracking-widest uppercase bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">Co-Working</span>
              </div>
            </div>

            <!-- Company Text -->
            <div class="text-xs text-slate-600 space-y-0.5 leading-relaxed">
              <p class="font-bold text-slate-800 text-sm">บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)</p>
              <p>98 หมู่ 2 อาคารบีเวิร์ค ยูนิต 602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120</p>
              <p class="text-slate-500">เลขประจำตัวผู้เสียภาษี: <span class="font-mono font-medium text-slate-700">0125554000401</span> | โทร: <span class="font-mono">02-123-4567</span></p>
            </div>
          </div>

          <!-- Customer Info Box (Interactive Card) -->
          <div class="mt-6 pt-4 border-t border-slate-100 bg-slate-50/80 p-4 rounded-xl border border-slate-200/60">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-orange-600 uppercase tracking-wider flex items-center gap-1.5">
                <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
                ข้อมูลลูกค้า / ผู้สั่งซื้อ (Customer)
              </span>
              <button onclick="openCustomerModal()" type="button" class="no-print text-[11px] text-orange-600 hover:text-orange-700 font-semibold flex items-center gap-1 bg-white hover:bg-orange-50 px-2 py-1 rounded border border-orange-200 transition-colors shadow-2xs">
                <i data-lucide="search" class="w-3 h-3"></i>
                <span>ค้นหาลูกค้าเก่า</span>
              </button>
            </div>

            <div class="space-y-2">
              <!-- Customer Name -->
              <input id="customerName" type="text" value="บริษัท อินโนเวทีฟ โซลูชั่นส์ จำกัด (คุณธนพล เจริญทรัพย์)" 
                placeholder="ชื่อบริษัท / ชื่อผู้ติดต่อ *" 
                class="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all">
              
              <!-- Customer Address -->
              <textarea id="customerAddress" rows="2" 
                placeholder="ที่อยู่สำหรับออกเอกสารและใบเสร็จ..." 
                class="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all resize-none leading-relaxed">88/19 ถนนแจ้งวัฒนะ แขวงทุ่งสองห้อง เขตหลักสี่ กรุงเทพมหานคร 10210</textarea>
              
              <!-- Tax ID & Contact -->
              <div class="grid grid-cols-2 gap-2">
                <input id="customerTaxId" type="text" value="0105562089123" placeholder="เลขผู้เสียภาษี (Tax ID)" 
                  class="w-full bg-white border border-slate-200 rounded-lg px-3 py-1 text-xs text-slate-700 font-mono focus:border-orange-500 focus:ring-1 focus:ring-orange-500">
                <input id="customerPhone" type="text" value="081-987-6543 (คุณธนพล)" placeholder="เบอร์โทร / อีเมล" 
                  class="w-full bg-white border border-slate-200 rounded-lg px-3 py-1 text-xs text-slate-700 focus:border-orange-500 focus:ring-1 focus:ring-orange-500">
              </div>
            </div>
          </div>
        </div>

        <!-- Right 5 Cols: Quotation Title & Metadata Grid -->
        <div class="md:col-span-5 flex flex-col justify-between">
          <!-- Big Title Bar -->
          <div class="bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 p-4 rounded-xl text-white shadow-sm mb-4">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-2xl font-extrabold tracking-tight">ใบเสนอราคา</h1>
                <p class="text-[11px] text-orange-100 font-mono tracking-widest uppercase">QUOTATION</p>
              </div>
              <i data-lucide="file-text" class="w-8 h-8 text-white/30"></i>
            </div>
          </div>

          <!-- Metadata Key-Value List -->
          <div class="bg-slate-50/80 p-4 rounded-xl border border-slate-200/60 space-y-2.5 text-xs">
            
            <!-- Quote Number -->
            <div class="flex items-center justify-between border-b border-slate-200/60 pb-2">
              <span class="text-slate-500 font-medium">เลขที่ใบเสนอราคา:</span>
              <input id="quoteNo" type="text" value="QT2026080001" oninput="document.getElementById('headerQuoteNo').innerText = this.value"
                class="font-mono font-bold text-orange-600 text-right bg-transparent border-b border-dashed border-orange-300 focus:border-orange-500 focus:outline-none w-36 px-1 py-0.5">
            </div>

            <!-- Issue Date -->
            <div class="flex items-center justify-between border-b border-slate-200/60 pb-2">
              <span class="text-slate-500 font-medium">วันที่ออกเอกสาร:</span>
              <input id="issueDate" type="date" value="2026-08-24" 
                class="font-mono text-slate-800 text-right bg-transparent border border-slate-200 rounded px-2 py-0.5 text-xs focus:border-orange-500 focus:outline-none">
            </div>

            <!-- Valid Until -->
            <div class="flex items-center justify-between border-b border-slate-200/60 pb-2">
              <span class="text-slate-500 font-medium">ยืนยันราคาถึง (Valid):</span>
              <input id="validDate" type="date" value="2026-08-31" 
                class="font-mono text-emerald-600 font-semibold text-right bg-transparent border border-slate-200 rounded px-2 py-0.5 text-xs focus:border-orange-500 focus:outline-none">
            </div>

            <!-- Sales Person -->
            <div class="flex items-center justify-between border-b border-slate-200/60 pb-2">
              <span class="text-slate-500 font-medium">ผู้เสนอราคา (Sales):</span>
              <select id="salesPerson" class="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs text-slate-800 focus:border-orange-500 focus:outline-none w-36">
                <option value="คุณสมชาย ชื่นใจ (ฝ่ายขาย)">คุณสมชาย (ฝ่ายขาย)</option>
                <option value="คุณโอ ภัทรพล (ผู้จัดการ)" selected>คุณโอ (ผู้จัดการ)</option>
                <option value="คุณนภัสสรณ์ (บริการลูกค้า)">คุณนภัสสรณ์</option>
              </select>
            </div>

            <!-- Subject / Project -->
            <div class="flex items-center justify-between pt-0.5">
              <span class="text-slate-500 font-medium">ชื่องาน / โครงการ:</span>
              <input id="quoteSubject" type="text" value="บริการเช่าห้องประชุมและจัดเลี้ยงสัมมนา" 
                placeholder="ชื่องาน..." 
                class="text-right font-medium text-slate-800 bg-transparent border-b border-dashed border-slate-300 focus:border-orange-500 focus:outline-none w-44 px-1 py-0.5">
            </div>

          </div>
        </div>

      </div>

      <!-- ===================================================================== -->
      <!-- SECTION B: INTERACTIVE ITEMS TABLE & QUICK ADD BAR                    -->
      <!-- ===================================================================== -->
      <div class="mb-8">
        
        <!-- Interactive Table Container -->
        <div class="overflow-x-auto rounded-xl border border-slate-200 shadow-xs mb-4">
          <table class="w-full text-left border-collapse" id="itemsTable">
            <thead>
              <tr class="bg-gradient-to-r from-orange-600 to-amber-500 text-white text-xs font-semibold uppercase tracking-wider">
                <th class="py-3 px-3 w-10 text-center">#</th>
                <th class="py-3 px-3 min-w-[240px]">รายการ / รายละเอียด (Description)</th>
                <th class="py-3 px-3 w-20 text-center">จำนวน</th>
                <th class="py-3 px-3 w-28 text-right">ราคาต่อหน่วย</th>
                <th class="py-3 px-3 w-24 text-right">ส่วนลด</th>
                <th class="py-3 px-3 w-28 text-right">มูลค่าสุทธิ (฿)</th>
                <th class="py-3 px-2 w-10 text-center no-print"></th>
              </tr>
            </thead>
            <tbody id="itemsTableBody" class="divide-y divide-slate-100 text-xs">
              <!-- Rendered via JS -->
            </tbody>
          </table>
        </div>

        <!-- Quick Add Toolbar (Directly beneath table) -->
        <div class="no-print bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
          
          <!-- Category Pills -->
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
                <i data-lucide="layers" class="w-3.5 h-3.5 text-orange-500"></i> หมวดหมู่ด่วน:
              </span>
              <button onclick="filterCatalog('all')" class="cat-pill px-2.5 py-1 text-xs rounded-full bg-orange-600 text-white font-medium shadow-2xs">ทั้งหมด</button>
              <button onclick="filterCatalog('room')" class="cat-pill px-2.5 py-1 text-xs rounded-full bg-white hover:bg-orange-50 text-slate-600 border border-slate-200 font-medium">🏢 ห้องประชุม</button>
              <button onclick="filterCatalog('catering')" class="cat-pill px-2.5 py-1 text-xs rounded-full bg-white hover:bg-orange-50 text-slate-600 border border-slate-200 font-medium">☕ อาหาร & เบรค</button>
              <button onclick="filterCatalog('parking')" class="cat-pill px-2.5 py-1 text-xs rounded-full bg-white hover:bg-orange-50 text-slate-600 border border-slate-200 font-medium">🅿️ ที่จอดรถ</button>
              <button onclick="filterCatalog('equipment')" class="cat-pill px-2.5 py-1 text-xs rounded-full bg-white hover:bg-orange-50 text-slate-600 border border-slate-200 font-medium">🛠️ อุปกรณ์เสริม</button>
            </div>
            
            <button onclick="addNewBlankRow()" type="button" class="text-xs text-orange-600 hover:text-orange-700 font-semibold flex items-center gap-1 bg-white hover:bg-orange-50 px-2.5 py-1.5 rounded-lg border border-orange-200 shadow-2xs transition-all">
              <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
              <span>เพิ่มแถวเปล่า</span>
            </button>
          </div>

          <!-- Preset Item Selector & Quick Add Row -->
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-slate-200/60 items-center">
            
            <!-- Dropdown selector -->
            <div class="sm:col-span-6">
              <select id="catalogSelector" onchange="onCatalogSelect()" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 font-medium focus:border-orange-500 focus:outline-none shadow-2xs">
                <option value="">-- เลือกรายการสำเร็จรูปจาก B-WORK --</option>
                <!-- Populated via JS -->
              </select>
            </div>

            <!-- Qty -->
            <div class="sm:col-span-2">
              <div class="relative">
                <input id="quickQty" type="number" min="1" value="1" placeholder="จำนวน" class="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-mono text-center font-bold text-slate-800 focus:border-orange-500 focus:outline-none shadow-2xs">
                <span class="absolute right-2 top-2.5 text-[10px] text-slate-400">หน่วย</span>
              </div>
            </div>

            <!-- Unit Price -->
            <div class="sm:col-span-2">
              <div class="relative">
                <input id="quickPrice" type="number" min="0" step="0.01" placeholder="ราคา/หน่วย" class="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-mono text-right font-bold text-slate-800 focus:border-orange-500 focus:outline-none shadow-2xs">
                <span class="absolute left-2.5 top-2.5 text-[10px] text-slate-400">฿</span>
              </div>
            </div>

            <!-- Add Button -->
            <div class="sm:col-span-2">
              <button onclick="addQuickItem()" type="button" class="w-full bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold py-2 px-3 rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02]">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                <span>เพิ่มรายการ</span>
              </button>
            </div>

          </div>

        </div>

      </div>

      <!-- ===================================================================== -->
      <!-- SECTION C: FINANCIAL TOTALS & PAYMENT TERMS                           -->
      <!-- ===================================================================== -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-8 mb-8 pt-6 border-t border-slate-200">
        
        <!-- Left 7 Cols: Payment Terms & Thai Baht Text -->
        <div class="md:col-span-7 flex flex-col justify-between space-y-4">
          
          <!-- Payment Terms Card -->
          <div class="bg-slate-50/90 rounded-xl border border-slate-200 p-4 space-y-2">
            <h4 class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <i data-lucide="credit-card" class="w-3.5 h-3.5 text-orange-500"></i>
              เงื่อนไขการชำระเงินและโอนเงิน (Payment Terms)
            </h4>
            <div class="text-xs text-slate-600 space-y-1 leading-relaxed">
              <p>• โอนเงินเข้าบัญชี: <strong class="text-slate-800">บริษัท บิลท์ ฮาร์ท จำกัด (Built Heart Co., Ltd.)</strong></p>
              <p>• ธนาคาร: <strong class="text-slate-800">ธนาคารกรุงศรีอยุธยา (Krungsri)</strong> สาขา ซอฟต์แวร์ ปาร์ค</p>
              <p>• เลขที่บัญชี: <span class="font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">329-1-38429-0</span></p>
              <p>• ส่งหลักฐานการโอน: <span class="font-mono text-slate-700">coworking@bwork.biz</span> หรือ LINE Official: <span class="font-bold text-emerald-600">@bwork</span></p>
            </div>
          </div>

          <!-- Thai Baht Text Highlight Card -->
          <div class="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl border border-orange-200/80 p-3.5 flex items-center gap-3 shadow-2xs">
            <div class="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center flex-shrink-0">
              <span class="font-bold text-sm">฿</span>
            </div>
            <div>
              <div class="text-[10px] uppercase font-bold tracking-wider text-orange-600">จำนวนเงินตัวอักษร (Thai Baht Text)</div>
              <div id="thaiBahtTextDisplay" class="text-xs font-extrabold text-slate-800 tracking-wide mt-0.5">
                (หนึ่งพันห้าร้อยแปดสิบสามบาทหกสิบสตางค์)
              </div>
            </div>
          </div>

        </div>

        <!-- Right 5 Cols: Live Summary Math Box -->
        <div class="md:col-span-5 bg-slate-50/90 rounded-2xl border border-slate-200 p-5 space-y-3">
          
          <!-- Subtotal -->
          <div class="flex items-center justify-between text-xs text-slate-600">
            <span>รวมเป็นเงิน (Subtotal):</span>
            <span id="subtotalDisplay" class="font-mono font-semibold text-slate-800 text-sm">฿0.00</span>
          </div>

          <!-- Special Discount Input -->
          <div class="flex items-center justify-between text-xs text-slate-600">
            <span class="flex items-center gap-1">
              <span>ส่วนลดพิเศษ (Discount):</span>
            </span>
            <div class="flex items-center gap-1">
              <input id="discountInput" type="number" min="0" value="0" step="0.01" oninput="recalculate()"
                class="w-24 bg-white border border-slate-200 rounded px-2 py-0.5 text-right font-mono text-xs font-bold text-red-600 focus:border-orange-500 focus:outline-none">
              <span class="text-slate-400 text-xs">฿</span>
            </div>
          </div>

          <!-- Net Before Tax -->
          <div class="flex items-center justify-between text-xs text-slate-600 border-t border-slate-200/60 pt-2">
            <span>ราคาไม่รวมภาษีมูลค่าเพิ่ม:</span>
            <span id="netBeforeTaxDisplay" class="font-mono font-medium text-slate-800">฿0.00</span>
          </div>

          <!-- VAT 7% Toggle & Value -->
          <div class="flex items-center justify-between text-xs text-slate-600 border-t border-slate-200/60 pt-2">
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input id="vatToggle" type="checkbox" checked onchange="recalculate()" class="w-4 h-4 rounded text-orange-600 focus:ring-orange-500 border-slate-300">
              <span class="font-medium text-slate-700">ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
            </label>
            <span id="vatDisplay" class="font-mono font-semibold text-slate-800">฿0.00</span>
          </div>

          <!-- Withholding Tax (WHT) Toggle -->
          <div class="flex items-center justify-between text-xs text-slate-600 border-t border-slate-200/60 pt-2">
            <div class="flex items-center gap-1.5">
              <select id="whtRate" onchange="recalculate()" class="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700 focus:border-orange-500 focus:outline-none">
                <option value="0">ไม่หักภาษี ณ ที่จ่าย (0%)</option>
                <option value="1">หัก ณ ที่จ่าย 1% (ค่าขนส่ง)</option>
                <option value="3">หัก ณ ที่จ่าย 3% (บริการ)</option>
              </select>
            </div>
            <span id="whtDisplay" class="font-mono font-semibold text-red-600">-฿0.00</span>
          </div>

          <!-- GRAND TOTAL HIGHLIGHT -->
          <div class="bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl p-4 shadow-sm flex items-center justify-between mt-4">
            <div>
              <div class="text-[10px] tracking-wider uppercase font-bold text-orange-100">จำนวนเงินรวมทั้งสิ้น</div>
              <div class="text-xs text-orange-100/90 font-medium">Grand Total (Net)</div>
            </div>
            <div id="grandTotalDisplay" class="text-2xl font-black font-mono tracking-tight text-white">
              ฿0.00
            </div>
          </div>

        </div>

      </div>

      <!-- ===================================================================== -->
      <!-- SECTION D: SIGNATURES & APPROVAL FOOTER                               -->
      <!-- ===================================================================== -->
      <div class="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-center text-xs">
        
        <!-- Left: Customer Signature -->
        <div class="flex flex-col items-center justify-between h-36 p-4 rounded-xl border border-slate-100 bg-slate-50/40">
          <p class="font-bold text-slate-700">ผู้สั่งซื้อ / ในนามลูกค้า (Customer Approval)</p>
          <div class="w-48 border-b-2 border-slate-300 border-dashed mb-1"></div>
          <div class="text-slate-500 space-y-0.5 text-[11px]">
            <p>วันที่: ..... / ..... / ..........</p>
            <p>(ลงนามและประทับตราสำคัญ)</p>
          </div>
        </div>

        <!-- Right: Authorized Company Signature -->
        <div class="flex flex-col items-center justify-between h-36 p-4 rounded-xl border border-slate-100 bg-slate-50/40 relative">
          <!-- Official Badge / Stamp Placeholder -->
          <div class="absolute right-4 top-4 w-12 h-12 rounded-full border-2 border-orange-500/20 flex items-center justify-center rotate-[-12deg] pointer-events-none">
            <span class="text-[8px] font-black text-orange-500/30 uppercase tracking-tighter text-center leading-none">BUILT HEART<br>OFFICIAL</span>
          </div>

          <p class="font-bold text-slate-700">ผู้ออกเอกสาร / ในนาม บริษัท บิลท์ ฮาร์ท จำกัด</p>
          <div class="w-48 border-b-2 border-slate-300 border-dashed mb-1"></div>
          <div class="text-slate-500 space-y-0.5 text-[11px]">
            <p>วันที่: <span id="sigDate" class="font-mono">24/08/2569</span></p>
            <p class="text-orange-600 font-semibold">(ผู้มีอำนาจลงนาม)</p>
          </div>
        </div>

      </div>

    </div>

  </main>

  <!-- ========================================================================= -->
  <!-- CUSTOMER SELECTION MODAL                                                  -->
  <!-- ========================================================================= -->
  <div id="customerModal" class="no-print fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-2xl shadow-xl max-w-lg w-full border border-slate-200 overflow-hidden transform transition-all">
      <div class="p-4 bg-slate-900 text-white flex items-center justify-between">
        <h3 class="text-sm font-bold flex items-center gap-2">
          <i data-lucide="users" class="w-4 h-4 text-orange-400"></i>
          เลือกลูกค้าจากฐานข้อมูล
        </h3>
        <button onclick="closeCustomerModal()" class="text-slate-400 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div class="p-4 space-y-3">
        <input type="text" id="customerSearchInput" oninput="searchCustomers()" placeholder="พิมพ์ชื่อบริษัท, ชื่อผู้ติดต่อ, หรือเบอร์โทร..." 
          class="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-orange-500">
        
        <div class="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs" id="customerListContainer">
          <!-- Populated via JS -->
        </div>
      </div>
    </div>
  </div>

  <!-- TOAST NOTIFICATION CONTAINER -->
  <div id="toastContainer" class="no-print fixed bottom-6 right-6 z-50 flex flex-col gap-2"></div>

  <!-- ========================================================================= -->
  <!-- JAVASCRIPT LOGIC & ENGINE                                                 -->
  <!-- ========================================================================= -->
  <script>
    // 1. Predefined B-WORK Catalog
    const BWORK_CATALOG = [
      { id: 'R1', category: 'room', name: 'ห้องประชุม Mercury 302 (10 ที่นั่ง)', price: 500, unit: 'ชม.' },
      { id: 'R2', category: 'room', name: 'ห้องประชุม Saturn 303 (4 ที่นั่ง)', price: 300, unit: 'ชม.' },
      { id: 'R3', category: 'room', name: 'ห้องประชุม Venus 304 (6 ที่นั่ง)', price: 300, unit: 'ชม.' },
      { id: 'R4', category: 'room', name: 'ห้องอบรม Classroom 602 (30 ที่นั่ง)', price: 1200, unit: 'ชม.' },
      { id: 'C1', category: 'catering', name: 'Set Coffee Break พรีเมียม (กาแฟสด + ขนม 2 ชิ้น)', price: 85, unit: 'ท่าน' },
      { id: 'C2', category: 'catering', name: 'อาหารกลางวัน บุฟเฟต์ Set A', price: 250, unit: 'ท่าน' },
      { id: 'C3', category: 'catering', name: 'น้ำดื่มบรรจุขวด B-WORK', price: 15, unit: 'ขวด' },
      { id: 'P1', category: 'parking', name: 'บัตรจอดรถเหมาจ่ายรายวัน (All-Day Parking Pass)', price: 100, unit: 'คัน' },
      { id: 'E1', category: 'equipment', name: 'โปรเจกเตอร์ 4K & จอฉาย 120 นิ้ว', price: 500, unit: 'วัน' },
      { id: 'E2', category: 'equipment', name: 'ชุดไมโครโฟนไร้สาย (Wireless Mic Set)', price: 300, unit: 'วัน' }
    ];

    // 2. Predefined Customers DB
    const SAMPLE_CUSTOMERS = [
      { name: 'บริษัท อินโนเวทีฟ โซลูชั่นส์ จำกัด (คุณธนพล เจริญทรัพย์)', address: '88/19 ถนนแจ้งวัฒนะ แขวงทุ่งสองห้อง เขตหลักสี่ กรุงเทพมหานคร 10210', taxId: '0105562089123', phone: '081-987-6543' },
      { name: 'บริษัท ดิจิทัล บิซเนส คอนซัลติ้ง จำกัด (คุณอรอนงค์)', address: '123 อาคารสาทรซิตี้ทาวเวอร์ ชั้น 18 ถนนสาทรใต้ แขวงทุ่งมหาเมฆ เขตสาทร กทม. 10120', taxId: '0105559041289', phone: '02-678-9900' },
      { name: 'สถาบันพัฒนาผู้นำและนวัตกรรม (คุณกิตติศักดิ์)', address: '45/2 ซอยพหลโยธิน 8 แขวงสามเสนใน เขตพญาไท กรุงเทพฯ 10400', taxId: '0994000189234', phone: '089-445-5667' }
    ];

    // 3. Document Items State
    let items = [
      { id: 1, name: 'บริการเช่าห้องประชุม Venus 304 (รองรับ 6-8 ท่าน)', qty: 3, price: 300, discount: 0 },
      { id: 2, name: 'Set Coffee Break พรีเมียม (กาแฟสด + ขนมเบเกอรี่ 2 ชิ้น)', qty: 6, price: 85, discount: 0 },
      { id: 3, name: 'บัตรจอดรถเหมาจ่ายรายวัน (All-Day Parking Pass)', qty: 2, price: 100, discount: 0 }
    ];

    // Initialize Page
    document.addEventListener('DOMContentLoaded', () => {
      lucide.createIcons();
      populateCatalogSelector('all');
      renderItemsTable();
      renderCustomerList();
    });

    // Populate catalog select dropdown
    function populateCatalogSelector(category = 'all') {
      const select = document.getElementById('catalogSelector');
      select.innerHTML = '<option value="">-- เลือกรายการสำเร็จรูปจาก B-WORK --</option>';
      
      const filtered = category === 'all' ? BWORK_CATALOG : BWORK_CATALOG.filter(c => c.category === category);
      filtered.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = `${item.name} (${item.price.toLocaleString()}.- / ${item.unit})`;
        select.appendChild(opt);
      });
    }

    // Filter catalog with category pills
    function filterCatalog(category) {
      document.querySelectorAll('.cat-pill').forEach(btn => {
        btn.classList.remove('bg-orange-600', 'text-white');
        btn.classList.add('bg-white', 'text-slate-600');
      });
      event.target.classList.remove('bg-white', 'text-slate-600');
      event.target.classList.add('bg-orange-600', 'text-white');
      populateCatalogSelector(category);
    }

    // On Catalog Select Handler
    function onCatalogSelect() {
      const selectedId = document.getElementById('catalogSelector').value;
      const found = BWORK_CATALOG.find(c => c.id === selectedId);
      if (found) {
        document.getElementById('quickPrice').value = found.price;
        document.getElementById('quickQty').value = 1;
      }
    }

    // Add Item from Quick Bar
    function addQuickItem() {
      const selectedId = document.getElementById('catalogSelector').value;
      const qty = parseFloat(document.getElementById('quickQty').value) || 1;
      const price = parseFloat(document.getElementById('quickPrice').value) || 0;
      
      let itemName = 'รายการบริการทั่วไป';
      if (selectedId) {
        const found = BWORK_CATALOG.find(c => c.id === selectedId);
        if (found) itemName = found.name;
      }

      items.push({
        id: Date.now(),
        name: itemName,
        qty: qty,
        price: price,
        discount: 0
      });

      renderItemsTable();
      showToast('เพิ่มรายการสำเร็จ', 'success');
      
      // Reset quick bar
      document.getElementById('catalogSelector').value = '';
      document.getElementById('quickPrice').value = '';
      document.getElementById('quickQty').value = '1';
    }

    // Add New Blank Row
    function addNewBlankRow() {
      items.push({
        id: Date.now(),
        name: 'ระบุชื่อรายการและรายละเอียด...',
        qty: 1,
        price: 0,
        discount: 0
      });
      renderItemsTable();
    }

    // Delete Row
    function deleteItem(index) {
      items.splice(index, 1);
      renderItemsTable();
      showToast('ลบรายการแล้ว', 'info');
    }

    // Render Items Table
    function renderItemsTable() {
      const tbody = document.getElementById('itemsTableBody');
      tbody.innerHTML = '';

      if (items.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="py-8 text-center text-slate-400 font-medium">
              <i data-lucide="package-open" class="w-6 h-6 mx-auto mb-1 text-slate-300"></i>
              ยังไม่มีรายการในใบเสนอราคา กรุณาเพิ่มรายการด้านล่าง
            </td>
          </tr>
        `;
        lucide.createIcons();
        recalculate();
        return;
      }

      items.forEach((item, idx) => {
        const net = Math.max(0, (item.qty * item.price) - item.discount);
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/80 transition-colors group';
        tr.innerHTML = `
          <td class="py-3 px-3 text-center text-slate-400 font-mono font-medium">${idx + 1}</td>
          <td class="py-2.5 px-3">
            <input type="text" value="${escapeHtml(item.name)}" oninput="updateItem(${idx}, 'name', this.value)"
              class="editable-cell w-full px-2 py-1 bg-transparent border-transparent hover:border-slate-200 border rounded font-medium text-slate-900 text-xs focus:bg-white transition-all">
          </td>
          <td class="py-2.5 px-3 text-center">
            <input type="number" min="1" step="any" value="${item.qty}" oninput="updateItem(${idx}, 'qty', this.value)"
              class="editable-cell w-16 px-1.5 py-1 text-center font-mono font-bold bg-transparent border-transparent hover:border-slate-200 border rounded text-slate-900 text-xs focus:bg-white transition-all">
          </td>
          <td class="py-2.5 px-3 text-right">
            <input type="number" min="0" step="0.01" value="${item.price}" oninput="updateItem(${idx}, 'price', this.value)"
              class="editable-cell w-24 px-1.5 py-1 text-right font-mono font-medium bg-transparent border-transparent hover:border-slate-200 border rounded text-slate-900 text-xs focus:bg-white transition-all">
          </td>
          <td class="py-2.5 px-3 text-right">
            <input type="number" min="0" step="0.01" value="${item.discount}" oninput="updateItem(${idx}, 'discount', this.value)"
              class="editable-cell w-20 px-1.5 py-1 text-right font-mono text-red-600 font-medium bg-transparent border-transparent hover:border-slate-200 border rounded text-xs focus:bg-white transition-all">
          </td>
          <td class="py-3 px-3 text-right font-mono font-bold text-slate-900">
            ฿${net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td class="py-3 px-2 text-center no-print">
            <button onclick="deleteItem(${idx})" type="button" class="text-slate-300 hover:text-red-600 transition-colors p-1 rounded hover:bg-red-50" title="ลบแถวนี้">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      lucide.createIcons();
      recalculate();
    }

    // Update single item field
    function updateItem(index, field, value) {
      if (field === 'qty' || field === 'price' || field === 'discount') {
        items[index][field] = parseFloat(value) || 0;
      } else {
        items[index][field] = value;
      }
      recalculate();
    }

    // Recalculate Totals & Thai Baht Text
    function recalculate() {
      let subtotal = 0;
      items.forEach(item => {
        const itemTotal = Math.max(0, (item.qty * item.price) - (item.discount || 0));
        subtotal += itemTotal;
      });

      const overallDiscount = parseFloat(document.getElementById('discountInput').value) || 0;
      const netBeforeTax = Math.max(0, subtotal - overallDiscount);

      const hasVat = document.getElementById('vatToggle').checked;
      const vatAmount = hasVat ? (netBeforeTax * 0.07) : 0;

      const whtPercent = parseFloat(document.getElementById('whtRate').value) || 0;
      const whtAmount = (netBeforeTax * (whtPercent / 100));

      const grandTotal = Math.max(0, netBeforeTax + vatAmount - whtAmount);

      // Update UI displays
      document.getElementById('subtotalDisplay').innerText = `฿${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('netBeforeTaxDisplay').innerText = `฿${netBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('vatDisplay').innerText = `฿${vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('whtDisplay').innerText = `-฿${whtAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('grandTotalDisplay').innerText = `฿${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Update Thai Baht Text
      const thaiText = thaiBahtText(grandTotal);
      document.getElementById('thaiBahtTextDisplay').innerText = `(${thaiText})`;
    }

    // =========================================================================
    // THAI BAHT TEXT CONVERTER ALGORITHM
    // =========================================================================
    function thaiBahtText(num) {
      if (num === null || num === undefined || isNaN(num) || num === 0) {
        return "ศูนย์บาทถ้วน";
      }

      num = Math.round(num * 100) / 100;
      const parts = num.toFixed(2).split(".");
      const integerPart = parts[0];
      const fractionPart = parts[1];

      const thaiNums = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
      const thaiUnits = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

      function convertBlock(str) {
        let result = "";
        const len = str.length;
        for (let i = 0; i < len; i++) {
          const digit = parseInt(str.charAt(i));
          const pos = len - i - 1;
          if (digit !== 0) {
            if (pos === 1 && digit === 1) {
              result += "สิบ";
            } else if (pos === 1 && digit === 2) {
              result += "ยี่สิบ";
            } else if (pos === 0 && digit === 1 && len > 1 && str.charAt(i - 1) !== "0") {
              result += "เอ็ด";
            } else {
              result += thaiNums[digit] + thaiUnits[pos];
            }
          }
        }
        return result;
      }

      let thaiText = "";
      if (parseInt(integerPart) > 0) {
        let intStr = integerPart;
        if (intStr.length > 6) {
          const overMillion = intStr.slice(0, -6);
          intStr = intStr.slice(-6);
          thaiText += convertBlock(overMillion) + "ล้าน";
        }
        thaiText += convertBlock(intStr) + "บาท";
      } else {
        thaiText += "ศูนย์บาท";
      }

      if (fractionPart === "00") {
        thaiText += "ถ้วน";
      } else {
        let fracStr = fractionPart;
        let fracResult = "";
        const d1 = parseInt(fracStr.charAt(0));
        const d2 = parseInt(fracStr.charAt(1));

        if (d1 === 1) fracResult += "สิบ";
        else if (d1 === 2) fracResult += "ยี่สิบ";
        else if (d1 > 2) fracResult += thaiNums[d1] + "สิบ";

        if (d2 === 1 && d1 > 0) fracResult += "เอ็ด";
        else if (d2 > 0) fracResult += thaiNums[d2];

        thaiText += fracResult + "สตางค์";
      }

      return thaiText;
    }

    // Customer Modal Handlers
    function openCustomerModal() {
      document.getElementById('customerModal').classList.remove('hidden');
    }
    function closeCustomerModal() {
      document.getElementById('customerModal').classList.add('hidden');
    }
    function renderCustomerList(list = SAMPLE_CUSTOMERS) {
      const container = document.getElementById('customerListContainer');
      container.innerHTML = '';
      list.forEach((c, idx) => {
        const div = document.createElement('div');
        div.className = 'p-3 hover:bg-orange-50/60 cursor-pointer flex justify-between items-center transition-colors';
        div.onclick = () => selectCustomer(c);
        div.innerHTML = `
          <div>
            <div class="font-bold text-slate-800">${c.name}</div>
            <div class="text-[11px] text-slate-500 truncate max-w-sm">${c.address}</div>
          </div>
          <span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded font-mono font-medium">${c.taxId || 'บุคคลธรรมดา'}</span>
        `;
        container.appendChild(div);
      });
    }
    function searchCustomers() {
      const query = document.getElementById('customerSearchInput').value.toLowerCase();
      const filtered = SAMPLE_CUSTOMERS.filter(c => 
        c.name.toLowerCase().includes(query) || 
        c.address.toLowerCase().includes(query) ||
        (c.phone && c.phone.includes(query))
      );
      renderCustomerList(filtered);
    }
    function selectCustomer(customer) {
      document.getElementById('customerName').value = customer.name;
      document.getElementById('customerAddress').value = customer.address;
      document.getElementById('customerTaxId').value = customer.taxId || '';
      document.getElementById('customerPhone').value = customer.phone || '';
      closeCustomerModal();
      showToast(`เลือกลูกค้า "${customer.name.slice(0, 20)}..." เรียบร้อย`, 'success');
    }

    // Print & PDF Trigger
    function triggerPrint() {
      window.print();
    }

    // Copy Link Trigger
    function copyDocumentLink() {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        showToast('คัดลอกลิงก์ใบเสนอราคาเรียบร้อยแล้ว!', 'success');
      });
    }

    // Save Quotation Handler
    function saveQuotation() {
      const quoteNumber = document.getElementById('quoteNo').value;
      showToast(`บันทึกใบเสนอราคา ${quoteNumber} เรียบร้อยแล้ว!`, 'success');
      document.getElementById('saveStatusText').innerText = `บันทึกล่าสุดเมื่อ ${new Date().toLocaleTimeString('th-TH')}`;
    }

    // Load Sample Data
    function loadSampleData() {
      items = [
        { id: 101, name: 'บริการเช่าห้องอบรมสัมมนา Classroom 602 (รวมโปรเจกเตอร์)', qty: 4, price: 1200, discount: 300 },
        { id: 102, name: 'Set Coffee Break พรีเมียม (กาแฟสด + ครัวซองต์)', qty: 25, price: 85, discount: 0 },
        { id: 103, name: 'บัตรจอดรถเหมาจ่ายรายวัน (All-Day Parking)', qty: 10, price: 100, discount: 200 }
      ];
      document.getElementById('customerName').value = 'บริษัท ดิจิทัล บิซเนส คอนซัลติ้ง จำกัด (คุณอรอนงค์)';
      document.getElementById('customerAddress').value = '123 อาคารสาทรซิตี้ทาวเวอร์ ชั้น 18 ถนนสาทรใต้ แขวงทุ่งมหาเมฆ เขตสาทร กทม. 10120';
      document.getElementById('customerTaxId').value = '0105559041289';
      document.getElementById('quoteSubject').value = 'โครงการอบรมบุคลากร Digital Transformation ประจำปี';
      renderItemsTable();
      showToast('โหลดข้อมูลตัวอย่างเรียบร้อย', 'info');
    }

    // Toast Notification Utility
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      
      const bgColor = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-red-600' : 'bg-slate-900';
      const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info';

      toast.className = `${bgColor} text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 text-xs font-semibold transform transition-all duration-300 translate-y-2 opacity-0`;
      toast.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i><span>${message}</span>`;
      
      container.appendChild(toast);
      lucide.createIcons();

      setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
      }, 50);

      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    // Escape HTML helper
    function escapeHtml(string) {
      return String(string).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>

</body>
</html>
