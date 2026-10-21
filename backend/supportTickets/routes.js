/**
 * supportTickets/routes.js
 * Express routes for Customer Support Tickets & Staff POS Management
 */

const express = require('express');
const { extractCustomerAuth } = require('./customerAuth');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  createTicket,
  listCustomerTickets,
  getCustomerTicketByNumber,
  addCustomerMessage,
  listStaffTickets,
  getStaffTicketDetail,
  updateTicketStatus,
  addStaffMessage,
  markTicketRead,
  getTicketNotificationCounts,
  getTicketAttachment
} = require('./service');

// Helper to save base64 image to uploads/
function saveBase64Attachment(base64Data, customName = 'attachment') {
  if (!base64Data || typeof base64Data !== 'string') return null;

  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    return null;
  }

  const mimeType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');

  // Max 5MB per attachment
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('ขนาดไฟล์เกินกำหนด (สูงสุด 5MB)');
  }

  let ext = 'jpg';
  if (mimeType.includes('png')) ext = 'png';
  else if (mimeType.includes('webp')) ext = 'webp';
  else if (mimeType.includes('pdf')) ext = 'pdf';

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const filename = `support_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, buffer);

  return {
    file_url: `/uploads/${filename}`,
    file_name: customName || filename,
    content_type: mimeType,
    file_size: buffer.length
  };
}

// Simple in-memory IP/phone rate limiter for public submissions
const rateLimitMap = new Map();
function checkPublicRateLimit(identifier) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 15;

  const entry = rateLimitMap.get(identifier) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
  } else {
    entry.count++;
  }
  rateLimitMap.set(identifier, entry);

  // Periodically clean stale entries
  if (rateLimitMap.size > 2000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  return entry.count <= maxAttempts;
}

/**
 * Public Customer Support Router
 * Mounted at: /api/public/support
 */
function createPublicSupportRouter(dbQuery) {
  const router = express.Router();

  // 1. POST /api/public/support/tickets (Create Ticket)
  router.post('/tickets', async (req, res) => {
    try {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const phoneId = req.body.customer_phone ? req.body.customer_phone.replace(/[^0-9]/g, '') : clientIp;
      if (!checkPublicRateLimit(phoneId)) {
        return res.status(429).json({ error: 'ท่านส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง' });
      }

      // Process base64 attachments if sent directly
      let processedAttachments = [];
      if (Array.isArray(req.body.attachments)) {
        for (const att of req.body.attachments) {
          if (att.base64Data) {
            const saved = saveBase64Attachment(att.base64Data, att.file_name);
            if (saved) processedAttachments.push(saved);
          } else if (att.file_url) {
            processedAttachments.push(att);
          }
        }
      }

      const result = await createTicket(dbQuery, {
        ...req.body,
        attachments: processedAttachments
      });

      res.status(201).json(result);
    } catch (err) {
      console.error('[PublicSupport] createTicket error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 2. GET /api/public/support/tickets (List customer tickets with server auth)
  router.get('/tickets', async (req, res) => {
    try {
      const auth = await extractCustomerAuth(req);
      if (!auth.lineUserId && !auth.bookingToken && (!auth.ticketTokens || auth.ticketTokens.length === 0)) {
        return res.status(401).json({
          error: 'กรุณายืนยันตัวตนด้วย LINE หรือ Ticket Token เพื่อดูประวัติการแจ้งปัญหา'
        });
      }

      const tickets = await listCustomerTickets(dbQuery, auth);
      res.json({ success: true, tickets });
    } catch (err) {
      console.error('[PublicSupport] listCustomerTickets error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 3. GET /api/public/support/tickets/:ticketNumber (Get Ticket Details with ownership verification)
  router.get('/tickets/:ticketNumber', async (req, res) => {
    try {
      const auth = await extractCustomerAuth(req);
      const result = await getCustomerTicketByNumber(dbQuery, req.params.ticketNumber, auth);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[PublicSupport] getCustomerTicket error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 4. POST /api/public/support/tickets/:ticketNumber/messages (Customer Reply with ownership verification)
  router.post('/tickets/:ticketNumber/messages', async (req, res) => {
    try {
      const auth = await extractCustomerAuth(req);
      const { message, sender_name, sender_phone, line_user_id, attachments } = req.body;

      // Process base64 attachments if sent directly
      let processedAttachments = [];
      if (Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att.base64Data) {
            const saved = saveBase64Attachment(att.base64Data, att.file_name);
            if (saved) processedAttachments.push(saved);
          } else if (att.file_url) {
            processedAttachments.push(att);
          }
        }
      }

      const result = await addCustomerMessage(dbQuery, req.params.ticketNumber, {
        sender_name,
        sender_phone,
        line_user_id,
        message,
        attachments: processedAttachments
      }, auth);

      res.status(201).json(result);
    } catch (err) {
      console.error('[PublicSupport] addCustomerMessage error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 4b. GET /api/public/support/tickets/:ticketNumber/attachments/:attachmentId (Attachment access with ownership check)
  router.get('/tickets/:ticketNumber/attachments/:attachmentId', async (req, res) => {
    try {
      const auth = await extractCustomerAuth(req);
      const attachment = await getTicketAttachment(dbQuery, req.params.ticketNumber, req.params.attachmentId, auth);
      res.json({ success: true, attachment });
    } catch (err) {
      console.error('[PublicSupport] getTicketAttachment error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 5. POST /api/public/support/upload (Direct Attachment Upload)
  router.post('/upload', (req, res) => {
    try {
      const { base64Data, imageName } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: 'กรุณาส่งข้อมูลรูปภาพ (base64Data)' });
      }

      const saved = saveBase64Attachment(base64Data, imageName);
      if (!saved) {
        return res.status(400).json({ error: 'รูปแบบข้อมูลรูปภาพไม่ถูกต้อง' });
      }

      res.json({ success: true, ...saved });
    } catch (err) {
      console.error('[PublicSupport] upload error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

/**
 * Staff POS Support Router
 * Mounted at: /api/pos/support (Requires staff authentication & permission)
 */
function createStaffSupportRouter(dbQuery) {
  const router = express.Router();

  // 1. GET /api/pos/support/notifications/count
  router.get('/notifications/count', async (req, res) => {
    try {
      const counts = await getTicketNotificationCounts(dbQuery, req.user?.username);
      res.json({ success: true, ...counts });
    } catch (err) {
      console.error('[StaffSupport] notifications/count error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/pos/support/tickets (List Tickets with filters)
  router.get('/tickets', async (req, res) => {
    try {
      const { status, category, priority, assigned_to, q, limit, offset } = req.query;
      const result = await listStaffTickets(dbQuery, {
        status,
        category,
        priority,
        assigned_to,
        q,
        limit,
        offset,
        staff_username: req.user?.username
      });
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[StaffSupport] listStaffTickets error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 3. GET /api/pos/support/tickets/:id (Ticket Detail + History)
  router.get('/tickets/:id', async (req, res) => {
    try {
      const result = await getStaffTicketDetail(dbQuery, req.params.id, req.user?.username);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[StaffSupport] getStaffTicketDetail error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 4. PATCH /api/pos/support/tickets/:id (Update Status / Priority / Assignee)
  router.patch('/tickets/:id', async (req, res) => {
    try {
      const { status, priority, assigned_to, notes } = req.body;
      const updated = await updateTicketStatus(dbQuery, req.params.id, {
        status,
        priority,
        assigned_to,
        staff_user: req.user,
        notes
      });
      res.json({ success: true, ticket: updated });
    } catch (err) {
      console.error('[StaffSupport] updateTicketStatus error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 5. POST /api/pos/support/tickets/:id/messages (Staff Reply or Internal Note)
  router.post('/tickets/:id/messages', async (req, res) => {
    try {
      const { message, visibility, attachments } = req.body;

      // Process base64 attachments if sent directly
      let processedAttachments = [];
      if (Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att.base64Data) {
            const saved = saveBase64Attachment(att.base64Data, att.file_name);
            if (saved) processedAttachments.push(saved);
          } else if (att.file_url) {
            processedAttachments.push(att);
          }
        }
      }

      const result = await addStaffMessage(dbQuery, req.params.id, {
        staff_user: req.user,
        message,
        visibility: visibility || 'public',
        attachments: processedAttachments
      });

      res.status(201).json(result);
    } catch (err) {
      console.error('[StaffSupport] addStaffMessage error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // 6. POST /api/pos/support/tickets/:id/read (Mark as read)
  router.post('/tickets/:id/read', async (req, res) => {
    try {
      await markTicketRead(dbQuery, req.params.id, req.user?.username);
      res.json({ success: true });
    } catch (err) {
      console.error('[StaffSupport] markTicketRead error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createPublicSupportRouter,
  createStaffSupportRouter,
  saveBase64Attachment
};
