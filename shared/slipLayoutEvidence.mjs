// Phase 3 & 4B layout evidence: pure extraction, no settings, booking or payment dependencies.
const boxOK = b => b && ['x0','y0','x1','y1'].every(k => Number.isFinite(b[k])) && b.x1 > b.x0 && b.y1 > b.y0;
const compactLabel = s => String(s || '').replace(/\s+/g, '').replace(/\u0E4D\u0E32/g, '\u0E33').normalize('NFKC').replace(/\u0E4D\u0E32/g, '\u0E33');
const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();

export function normalizeLayout(input = {}) {
  const result = [];
  const add = (l, blockIndex = 0, paragraphIndex = 0) => {
    if (!boxOK(l.bbox) || !String(l.text || '').trim()) return;
    result.push({
      text: String(l.text).trim(),
      confidence: Number.isFinite(l.confidence) && l.confidence >= 0 ? l.confidence : null,
      bbox: { ...l.bbox },
      lineIndex: result.length,
      blockIndex,
      paragraphIndex,
      words: (l.words || []).filter(w => boxOK(w.bbox)).map(w => ({ text: w.text, bbox: { ...w.bbox }, confidence: w.confidence ?? null }))
    });
  };
  if (Array.isArray(input)) input.slice(0, 2000).forEach(l => add(l, l.blockIndex, l.paragraphIndex));
  else if (input.blocks) input.blocks.forEach((b, bi) => (b.paragraphs || []).forEach((p, pi) => (p.lines || []).forEach(l => add(l, bi, pi))));
  else if (input.tsv) {
    const groups = new Map();
    for (const row of input.tsv.split(/\r?\n/).slice(1, 10001)) {
      const c = row.split('\t'); if (c[0] !== '5' || !c[11]) continue;
      const [x, y, w, h, confidence] = c.slice(6, 11).map(Number);
      const word = { text: c.slice(11).join('\t'), bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, confidence };
      if (!boxOK(word.bbox)) continue;
      const key = c.slice(1, 5).join(':');
      if (!groups.has(key)) groups.set(key, { blockIndex: Number(c[2]), paragraphIndex: Number(c[3]), words: [] });
      groups.get(key).words.push(word);
    }
    for (const g of groups.values()) {
      const words = g.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      add({
        text: words.map(w => w.text).join(' '),
        words,
        confidence: words.reduce((s, w) => s + w.confidence, 0) / words.length,
        bbox: {
          x0: Math.min(...words.map(w => w.bbox.x0)),
          y0: Math.min(...words.map(w => w.bbox.y0)),
          x1: Math.max(...words.map(w => w.bbox.x1)),
          y1: Math.max(...words.map(w => w.bbox.y1))
        }
      }, g.blockIndex, g.paragraphIndex);
    }
  }
  return result.slice(0, 2000);
}

const senderLabel = /^(?:จ\s*า\s*ก|ผ\s*ู้\s*โ\s*อ\s*น|From\b|Sender\b)\s*[:：-]?\s*/i;
const receiverLabel = /^(?:ถ\s*ึ\s*ง|ผ\s*ู้\s*ร\s*ั\s*บ(?:\s*เ\s*ง\s*ิ\s*น)?|ผู้\s*รับ(?:เงิน)?|ไ\s*ป\s*ย\s*ั\s*ง|To\b|Receiver\b|Beneficiary\b)\s*[:：-]?\s*/i;
const boundary = /^(?:Amount|Fee|Balance|Date|Time|Reference|Ref\b|Transaction|จำนวน|ยอด|ค่าธรรมเนียม|วันที่|เวลา|เลขที่|จ\s*ำ\s*น\s*ว\s*น|ย\s*อ\s*ด|ค\s*่\s*า\s*ธ\s*ร\s*ร\s*ม\s*เ\s*น\s*ี\s*ย\s*ม|ว\s*ั\s*น\s*ท\s*ี\s*่|เ\s*ว\s*ล\s*า|เ\s*ล\s*ข\s*ท\s*ี\s*่)/i;
const negative = s => /fee|balance|ค่าธรรมเนียม|ยอด(?:เงิน)?คงเหลือ/i.test(compactLabel(s));
const amountLabel = s => /^(?:amount|total|จำนวนเงิน|จำนวน|ยอดโอน|ยอดชำระ)/i.test(compactLabel(s));
const referenceLabel = s => /^(?:ref(?:erence)?(?:id)?[:.]?|transaction(?:id|no)|รหัสอ้างอิง|เลขที่รายการ|เลขที่อ้างอิง)/i.test(compactLabel(s));

function nearby(a, l) {
  const b = l.bbox, h = a.bbox.y1 - a.bbox.y0;
  const ab = a.bbox;
  return (b.y0 >= ab.y1 - 2 && b.y0 - ab.y1 <= h * 12 && Math.abs(b.x0 - ab.x0) <= Math.max(h * 3, ab.x1 - ab.x0)) ||
    (Math.abs(b.y0 - ab.y0) <= h / 2 && b.x0 >= ab.x1 && b.x0 - ab.x1 <= h * 8);
}

function cleanLogoFromLine(anchor, marker, rawText) {
  const words = anchor?.words || [];
  if (words.length >= 3 && /^[@©®]$/.test(words[1].text)) {
    const icon = words[1], first = words[2];
    if (first.bbox.x0 - icon.bbox.x1 >= -2 && !/[*•]/.test(icon.text)) {
      const visible = words.slice(2).map(w => w.text).join(' ').trim();
      if (visible) return { name: visible, excludedToken: icon.text };
    }
  }
  const match = rawText.match(/^[@©®]\s+(.+)$/);
  if (match) return { name: match[1].trim(), excludedToken: rawText[0] };
  return { name: rawText, excludedToken: null };
}

export function layoutRoles(lines, normalizeName) {
  const anchors = { sender: lines.filter(l => senderLabel.test(l.text)), receiver: lines.filter(l => receiverLabel.test(l.text)) }, result = {};
  for (const role of ['sender', 'receiver']) {
    const own = anchors[role], other = anchors[role === 'sender' ? 'receiver' : 'sender'];
    const empty = { rawName: null, normalizedName: null, accountMasked: null, roleEvidence: [], confidenceTier: 'uncertain', warnings: ['role_ambiguous'] };
    // Image 410 protection: "10" is NOT "TO". Ambiguous anchor count must fail closed without guessing.
    if (own.length !== 1) { result[role] = empty; continue; }
    const anchor = own[0], marker = role === 'sender' ? senderLabel : receiverLabel, inline = anchor.text.replace(marker, '').trim();
    let conflict = false;
    const selected = lines.filter(l => {
      if (l === anchor || senderLabel.test(l.text) || receiverLabel.test(l.text) || boundary.test(l.text) || !nearby(anchor, l)) return false;
      if (lines.some(s => s !== anchor && (senderLabel.test(s.text) || receiverLabel.test(s.text) || boundary.test(s.text)) &&
        s.bbox.y0 > anchor.bbox.y0 && s.bbox.y0 <= l.bbox.y0 && Math.abs(s.bbox.x0 - anchor.bbox.x0) < (anchor.bbox.y1 - anchor.bbox.y0) * 3)) return false;
      if (other.some(o => nearby(o, l) && !(anchor.bbox.y0 > o.bbox.y0 &&
        anchor.bbox.y0 <= l.bbox.y0 && Math.abs(anchor.bbox.x0 - o.bbox.x0) < (o.bbox.y1 - o.bbox.y0) * 3))) { conflict = true; return false; }
      return true;
    }).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

    const texts = [...(inline ? [inline] : []), ...selected.map(l => l.text)];
    const accounts = texts.filter(t => /^(?:[\dxX*•][ -]?){4,}$/.test(t));
    const names = texts.filter(t => !accounts.includes(t) && !/^(?:ธ\.|ธนาคาร|SCB\b|KBANK\b|Krungsri\b)/i.test(t));
    if (inline && (senderLabel.test(inline) || receiverLabel.test(inline))) conflict = true;

    if (conflict || !names.length) {
      result[role] = conflict ? { ...empty, confidenceTier: 'conflict', warnings: ['role_ambiguous', 'role_conflict'] } : empty;
      continue;
    }

    const cleaned = cleanLogoFromLine(anchor, marker, names[0]);
    const finalRawName = cleaned.name;
    const warnings = [...(accounts.length > 1 ? ['account_ambiguous'] : [])];
    if (cleaned.excludedToken) warnings.push('spatial_logo_token_excluded');

    result[role] = {
      rawName: finalRawName,
      normalizedName: normalizeName(finalRawName),
      nameVariants: names,
      accountMasked: accounts.length === 1 ? accounts[0] : null,
      roleEvidence: [anchor, ...selected],
      confidenceTier: 'partial',
      warnings,
      diagnosticProvenance: cleaned.excludedToken ? { source: 'explicit_role_spatial_words', excludedToken: cleaned.excludedToken } : null
    };
  }
  return result;
}

const months = [
  ['มกราคม', 'ม.ค.', 'january', 'jan'], ['กุมภาพันธ์', 'ก.พ.', 'february', 'feb'], ['มีนาคม', 'มี.ค.', 'march', 'mar'],
  ['เมษายน', 'เม.ย.', 'april', 'apr'], ['พฤษภาคม', 'พ.ค.', 'may'], ['มิถุนายน', 'มิ.ย.', 'june', 'jun'],
  ['กรกฎาคม', 'ก.ค.', 'july', 'jul'], ['สิงหาคม', 'ส.ค.', 'august', 'aug'], ['กันยายน', 'ก.ย.', 'september', 'sep', 'sept'],
  ['ตุลาคม', 'ต.ค.', 'october', 'oct'], ['พฤศจิกายน', 'พ.ย.', 'november', 'nov'], ['ธันวาคม', 'ธ.ค.', 'december', 'dec']
];

export function parseDate(text) {
  text = String(text || '').replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0E50));
  let d, m, y, match = text.match(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (match) [, y, m, d] = match;
  else if ((match = text.match(/(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/))) [, d, m, y] = match;
  else {
    let compactText = text.replace(/(?<=[ก-๙.])\s+(?=[ก-๙.])/g, '').toLowerCase();
    // Deterministic cleanup of unambiguous Thai month abbreviations with OCR diacritic noise:
    // "ก.ุพ." / "กุ.พ." -> "ก.พ." (กุมภาพันธ์ is the unique Thai month abbreviation starting with ก and ending with พ)
    compactText = compactText.replace(/ก\.?[\u0E38\u0E39]?\.?พ\.?/g, 'ก.พ.');
    for (let i = 0; i < months.length; i++) {
      for (const month of months[i]) {
        const escaped = month.replace(/\./g, '\\.');
        match = compactText.match(new RegExp('(?:^|[^\\d])(\\d{1,2})\\s+' + escaped + '\\s+(\\d{4})(?!\\d)'));
        if (match) { d = match[1]; m = i + 1; y = match[2]; break; }
      }
      if (y) break;
    }
  }
  if (!y) return null;
  y = Number(y); m = Number(m); d = Number(d);
  if (y >= 2400 && y <= 2999) y -= 543;
  if (y < 1600 || y > 2400) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ?
    String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') : null;
}

function labeled(rows, label) {
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (/booking|reservation|screenshot|status\s*bar|statusbar|วันจอง|วันที่จอง|วันเข้าพัก/i.test(r.text)) continue;
    const match = r.text.match(label); if (!match) continue;
    let raw = r.text.slice(match.index + match[0].length).replace(/^\s*[:：-]\s*/, '').trim(), evidence = [r];
    if (!raw) {
      const options = r.bbox ? rows.filter(l => l !== r && nearby(r, l) && !boundary.test(l.text)) : (rows[i + 1] ? [rows[i + 1]] : []);
      if (options.length !== 1) continue;
      raw = options[0].text; evidence.push(options[0]);
    }
    result.push({ raw, evidence });
  }
  return result;
}

export function temporalAndReference(text, layout = [], qr = null) {
  const rows = layout.length ? layout : String(text || '').split(/\r?\n/).map((t, lineIndex) => ({ text: t.trim(), lineIndex })).filter(l => l.text);

  // 1. Explicit labeled dates/times
  const dates = labeled(rows, /(?:วันที่(?:โอน)?|Date\b)/i).map(c => ({ ...c, value: parseDate(c.raw) })).filter(c => c.value);
  const timeRegex = /(?<![\d:])(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d(?:\s*:\s*[0-5]\d)?(?:\s*[AP]M\b|(?![0-9a-zA-Z:]))/i;
  const times = labeled(rows, /(?:เวลา(?:โอน)?|Time\b|วันที่(?:โอน)?|Date\b)/i).map(c => {
    const m = c.raw.match(timeRegex);
    return { ...c, value: m ? m[0].replace(/\s*:\s*/g, ':') : null };
  }).filter(c => c.value);

  // 2. Contextual transaction completion anchors (Successful payment, ทำรายการสำเร็จ, etc.)
  const anchors = rows.filter(l => /successful(?:transfer|payment)|transfercompleted|ทำรายการสำเร็จ|กํารายการสําเร็จ|รายการสำเร็จ|โอนเงินสำเร็จ|จ่ายบิลสำเร็จ/i.test(compactLabel(l.text)) ||
    referenceLabel(l.text) || (/^COMPLETED$/i.test(compactLabel(l.text)) && rows.some(p => /TRANSFER/i.test(compactLabel(p.text)) && p.bbox && l.bbox && p.bbox.y0 < l.bbox.y0 && l.bbox.y0 - p.bbox.y0 < 150)));

  const contextualCandidates = [];
  for (const line of rows) {
    if (/booking|reservation|screenshot|status\s*bar|statusbar|วันจอง|วันที่จอง/i.test(compactLabel(line.text))) continue;
    const source = anchors.find(a => a !== line && (!a.bbox || !line.bbox || (line.bbox.y0 >= a.bbox.y0 &&
      line.bbox.y0 - a.bbox.y1 <= Math.max(120, (a.bbox.y1 - a.bbox.y0) * 2) &&
      Math.min(a.bbox.x1, line.bbox.x1) > Math.max(a.bbox.x0, line.bbox.x0))));
    if (!source) continue;
    // Require a date-shaped string to prevent bare phone status-bar times from being accepted
    const dateShape = /(?:\d{1,2}\s+[A-Za-zก-๙.ุ]+\s+\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/i;
    if (!dateShape.test(line.text.replace(/(?<=[ก-๙.])\s+(?=[ก-๙.])/g, ''))) continue;
    const date = parseDate(line.text);
    const m = line.text.match(timeRegex);
    const timeVal = m ? m[0].replace(/\s*:\s*/g, ':') : null;
    contextualCandidates.push({ raw: line.text, date, time: timeVal, line, transactionAnchor: source });
  }

  const allDates = [...dates.map(d => d.value), ...contextualCandidates.map(c => c.date)].filter(v => v !== null);
  const allTimes = [...times.map(t => t.value), ...contextualCandidates.map(c => c.time)].filter(v => v !== null);

  const distinctDates = [...new Set(allDates)];
  const distinctTimes = [...new Set(allTimes)];

  const dc = distinctDates.length > 1, tc = distinctTimes.length > 1;
  const finalDate = dc ? null : distinctDates[0] ?? null;
  const finalTime = tc ? null : distinctTimes[0] ?? null;

  // 3. Reference extraction (supporting Thai space tolerance in layout)
  const refs = [];
  for (const row of rows) {
    if (/booking|reservation|screenshot|status\s*bar|statusbar/i.test(row.text)) continue;
    const m1 = row.text.match(/(?:เลขที่รายการ|เลขที่อ้างอิง|รหัสอ้างอิง|Reference\b|Ref\b|Transaction\s*(?:ID|No)\b)\s*[.:：-]?/i);
    let val = null;
    if (m1) {
      val = row.text.slice(m1.index + m1[0].length).replace(/^[:：.-]\s*/, '').trim();
    } else if (/^(?:เลขที่รายการ|เลขที่อ้างอิง|รหัสอ้างอิง)/.test(compactLabel(row.text))) {
      const match = compactLabel(row.text).match(/^(?:เลขที่รายการ|เลขที่อ้างอิง|รหัสอ้างอิง)(.+)$/);
      if (match) val = match[1].trim();
    }
    if (val && /^[a-z0-9-]{4,80}$/i.test(val)) refs.push({ raw: val, value: val, evidence: [row] });
  }

  const qrRef = qr?.isValidSlipQR && qr.transRef ? qr.transRef : null;
  const uniqueRefs = [...new Set(refs.map(r => r.value))];
  const conflict = uniqueRefs.length > 1 || Boolean(qrRef && refs.some(c => c.value !== qrRef));
  const ref = conflict ? null : qrRef ?? refs[0]?.value ?? null;
  const ambiguous = !qrRef && Boolean(ref && /[O0I1lS5B8]/.test(ref));

  return {
    datetime: {
      raw: contextualCandidates.map(c => c.raw).join('\n') || null,
      date: finalDate,
      time: finalTime,
      evidence: { dates, times, contextualCandidates },
      confidenceTier: dc || tc ? 'conflict' : finalDate && finalTime ? 'partial' : 'uncertain',
      warnings: dc || tc ? ['datetime_conflict'] : finalDate === null && contextualCandidates.length ? ['year_or_date_uncertain'] : []
    },
    reference: {
      raw: refs[0]?.raw ?? qrRef,
      value: ref,
      source: conflict ? null : qrRef ? 'qr' : ref ? 'ocr' : null,
      evidence: { qrReference: qrRef, candidates: refs },
      confidenceTier: conflict ? 'conflict' : ambiguous || !ref ? 'uncertain' : qrRef ? 'strong' : 'partial',
      warnings: conflict ? ['reference_conflict'] : ambiguous ? ['reference_character_ambiguity'] : ref ? [] : ['reference_unreadable']
    }
  };
}

export function spatialAmount(evidenceAmount, layoutLines = []) {
  if (evidenceAmount?.value !== null || evidenceAmount?.evidence?.recoveredAcrossFeeContext) return evidenceAmount;
  const anchors = layoutLines.filter(l => amountLabel(l.text) && !negative(l.text));
  const candidates = [];
  for (const a of anchors) {
    const first = a.words?.[0]; if (!first) continue;
    const relevant = layoutLines.filter(l => l === a || (l.bbox.y0 >= a.bbox.y0 && l.bbox.y0 - a.bbox.y1 < Math.max(100, a.bbox.y1 - a.bbox.y0)));
    for (const l of relevant) {
      if (negative(l.text) || referenceLabel(l.text)) continue;
      if (layoutLines.some(stop => negative(stop.text) && stop.bbox.y0 > a.bbox.y0 && stop.bbox.y0 < l.bbox.y0)) continue;
      if (l !== a && Math.abs(l.bbox.x0 - first.bbox.x0) > (first.bbox.y1 - first.bbox.y0) * 2) continue;
      for (let i = 0; i < (l.words || []).length; i++) {
        const word = l.words[i];
        const match = String(word.text || '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
        const satang = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
        if (satang === null || satang <= 0 || /^\d{9,}$/.test(word.text)) continue;
        if (word.confidence === null || word.confidence < 80) continue;
        if (l === a && i < 1) continue;
        const preceding = l.words.slice(l === a ? 1 : 0, i);
        if (preceding.some(w => !/^[:：฿]$/.test(w.text))) continue;
        candidates.push({ value: satang / 100, raw: word.text, bbox: word.bbox, confidence: word.confidence,
          source: 'explicit_amount_label_spatial_token', anchor: a, line: l });
      }
    }
  }
  const distinct = [...new Set(candidates.map(c => c.value))];
  if (distinct.length !== 1) return { ...evidenceAmount, diagnosticCandidates: candidates };
  return {
    ...evidenceAmount,
    value: distinct[0],
    raw: candidates[0].raw,
    confidenceTier: 'partial',
    warnings: [...(evidenceAmount?.warnings || []), 'evidence_only_amount_recovery_not_payment_eligible'],
    diagnosticCandidates: candidates,
    paymentUseAllowed: false
  };
}
