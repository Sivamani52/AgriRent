import { BrevoClient } from '@getbrevo/brevo';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '../templates');

// In-memory record of dispatched emails for testing and audit logs
const sentEmailsLog = [];

let brevoClient = null;

function getBrevoClient() {
  const apiKey = process.env.BREVO_API_KEY || process.env.brevo_key;
  if (!apiKey) {
    return null;
  }
  if (!brevoClient) {
    brevoClient = new BrevoClient({ apiKey });
  }
  return brevoClient;
}

/**
 * Escapes special HTML characters to prevent XSS / injection in email templates
 * @param {any} val
 * @returns {string}
 */
export function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validates email format strictly
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}

/**
 * Reads and renders an HTML template with variable replacement
 * @param {string} templateName - e.g. 'otpEmail.html'
 * @param {object} data - Key-value map of variables
 * @returns {string} - Rendered HTML
 */
export function renderTemplate(templateName, data = {}) {
  const layoutPath = path.join(TEMPLATES_DIR, 'baseLayout.html');
  const templatePath = path.join(TEMPLATES_DIR, templateName);

  let layoutHtml = '';
  let bodyHtml = '';

  try {
    layoutHtml = fs.readFileSync(layoutPath, 'utf8');
  } catch (err) {
    layoutHtml = '<html><body>{{{bodyContent}}}</body></html>';
  }

  try {
    bodyHtml = fs.readFileSync(templatePath, 'utf8');
  } catch (err) {
    bodyHtml = `<p>${escapeHtml(data.message || '')}</p>`;
  }

  // Handle conditional sections {{#key}}content{{/key}}
  for (const [key, value] of Object.entries(data)) {
    const sectionRegex = new RegExp(`{{#${key}}}([\\s\\S]*?){{/${key}}}`, 'g');
    if (value) {
      bodyHtml = bodyHtml.replace(sectionRegex, '$1');
    } else {
      bodyHtml = bodyHtml.replace(sectionRegex, '');
    }
  }
  // Clear any remaining false conditional sections
  bodyHtml = bodyHtml.replace(/{{#[a-zA-Z0-9_]+}}[\s\S]*?{{\/[a-zA-Z0-9_]+}}/g, '');

  // Handle variable replacements in body {{key}} (with HTML escaping)
  for (const [key, value] of Object.entries(data)) {
    const varRegex = new RegExp(`{{${key}}}`, 'g');
    bodyHtml = bodyHtml.replace(varRegex, value !== undefined && value !== null ? escapeHtml(value) : '');
  }

  // Inject body into layout
  let finalHtml = layoutHtml.replace('{{{bodyContent}}}', bodyHtml);
  finalHtml = finalHtml.replace(/{{title}}/g, escapeHtml(data.title || 'AgriRent Notification'));

  return finalHtml;
}

/**
 * Primary dispatch function for Brevo Transactional Email
 * Guaranteed NON-BLOCKING: Does not throw or break calling business logic
 *
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} [params.toName] - Recipient display name
 * @param {string} params.subject - Email subject line
 * @param {string} [params.template] - Template file name in backend/templates
 * @param {object} [params.templateData] - Template variables
 * @param {string} [params.htmlContent] - Explicit HTML override
 * @param {string} [params.textContent] - Plain text content
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendEmail({
  to,
  toName = 'User',
  subject,
  template,
  templateData = {},
  htmlContent,
  textContent
}) {
  if (!to || !isValidEmail(to)) {
    console.warn(`[Brevo Email Warning] Invalid recipient email address: "${to}". Skipping dispatch.`);
    return { success: false, reason: 'INVALID_EMAIL' };
  }

  let finalHtml = htmlContent;
  if (!finalHtml && template) {
    try {
      finalHtml = renderTemplate(template, { recipientName: toName, ...templateData });
    } catch (tplErr) {
      console.error(`[Brevo Email Warning] Template rendering failed for ${template}:`, tplErr.message);
      finalHtml = `<p>${templateData.message || subject}</p>`;
    }
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@agrirent.com';
  const senderName = process.env.BREVO_SENDER_NAME || 'AgriRent';

  const emailRecord = {
    to: to.trim().toLowerCase(),
    toName,
    subject,
    template,
    templateData,
    htmlContent: finalHtml,
    timestamp: new Date().toISOString()
  };

  // Keep an in-memory record for test asserts and auditing, capped at 500 entries
  if (sentEmailsLog.length >= 500) {
    sentEmailsLog.shift();
  }
  sentEmailsLog.push(emailRecord);

  // If in automated test mode without valid remote network or if Brevo key is missing, return success record
  const client = getBrevoClient();
  if (!client) {
    console.log(`[Brevo Email DevLog] Brevo API key not set. Email logged to sentEmailsLog: ${subject} -> ${to}`);
    return { success: true, mock: true, recipient: to, subject };
  }

  try {
    const response = await client.transactionalEmails.sendTransacEmail({
      sender: {
        email: senderEmail,
        name: senderName
      },
      to: [
        {
          email: to.trim().toLowerCase(),
          name: toName || 'AgriRent User'
        }
      ],
      subject,
      htmlContent: finalHtml,
      ...(textContent ? { textContent } : {})
    });

    return {
      success: true,
      messageId: response?.messageId || 'sent',
      recipient: to
    };
  } catch (err) {
    // Non-blocking error handling
    console.error(`[Brevo Email Error] Failed sending "${subject}" to ${to}: ${err.message}`);
    return {
      success: false,
      error: err.message,
      recipient: to
    };
  }
}

/**
 * Testing & verification helpers
 */
export function getSentEmails() {
  return [...sentEmailsLog];
}

export function clearSentEmails() {
  sentEmailsLog.length = 0;
}

export function getLastEmailFor(email) {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  for (let i = sentEmailsLog.length - 1; i >= 0; i--) {
    if (sentEmailsLog[i].to === normalized) {
      return sentEmailsLog[i];
    }
  }
  return null;
}

export default {
  sendEmail,
  renderTemplate,
  isValidEmail,
  getSentEmails,
  clearSentEmails,
  getLastEmailFor
};
