import dotenv from "dotenv";
dotenv.config();

/**
 * Normalizes phone numbers to standard 10-digit Indian mobile number format.
 * Trims spaces, hyphens, and removes +91 or 0 prefix if present.
 * @param {string} phone - Raw phone number string
 * @returns {string|null} - 10-digit mobile number or null if invalid
 */
export const normalizePhoneNumber = (phone) => {
    if (!phone) return null;
    const cleaned = String(phone).replace(/[\s\-\(\)]/g, "");
    const match = cleaned.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
    return match ? match[1] : null;
};

/**
 * Core SMS Dispatch Function.
 * Connects to legitimate SMS Gateway API (Fast2SMS or Twilio).
 * Credentials must be configured in environment variables.
 * Never throws an unhandled error to prevent blocking critical database operations.
 *
 * @param {object} params
 * @param {string} params.phone - Recipient mobile phone number
 * @param {string} params.message - Message body text
 * @param {string} [params.eventType] - Event identifier for logging
 * @returns {Promise<{success: boolean, delivered: boolean, error?: string, messageId?: string}>}
 */
export const sendSMS = async ({ phone, message, eventType = "GENERAL" }) => {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
        console.warn(`⚠️ [SMS Service] Invalid phone number provided: "${phone}". Message not sent.`);
        return {
            success: false,
            delivered: false,
            error: `Invalid Indian mobile number: ${phone}`
        };
    }

    const provider = (process.env.SMS_PROVIDER || "fast2sms").toLowerCase();

    // 1. Fast2SMS Provider Integration (India's leading developer SMS gateway)
    if (provider === "fast2sms") {
        const apiKey = process.env.FAST2SMS_API_KEY;
        if (!apiKey) {
            console.warn(
                `⚠️ [SMS Service] Fast2SMS credentials missing (FAST2SMS_API_KEY). ` +
                `Event: ${eventType}, Recipient: ${normalizedPhone}. SMS not delivered.`
            );
            return {
                success: false,
                delivered: false,
                error: "SMS provider credentials not configured (FAST2SMS_API_KEY missing)"
            };
        }

        try {
            const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
                method: "POST",
                headers: {
                    "authorization": apiKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    route: "q", // Quick SMS route
                    message: message,
                    language: "english",
                    flash: 0,
                    numbers: normalizedPhone
                })
            });

            const data = await response.json().catch(() => null);

            if (response.ok && data && (data.return === true || data.status_code === 200)) {
                console.log(
                    `✅ [SMS Service] Fast2SMS sent successfully to ${normalizedPhone} [${eventType}]. Request ID: ${data.request_id || "N/A"}`
                );
                return {
                    success: true,
                    delivered: true,
                    messageId: data.request_id || null
                };
            } else {
                let errMsg = "Provider rejected SMS";
                if (data) {
                    if (Array.isArray(data.message) && data.message.length > 0) {
                        errMsg = data.message[0];
                    } else if (typeof data.message === "string") {
                        errMsg = data.message;
                    } else if (response.statusText) {
                        errMsg = response.statusText;
                    }
                }
                console.error(
                    `❌ [SMS Service] Fast2SMS API error (${response.status}): ${errMsg}`
                );
                return {
                    success: false,
                    delivered: false,
                    error: `Fast2SMS error: ${errMsg}`
                };
            }
        } catch (error) {
            console.error(`❌ [SMS Service] Fast2SMS network error:`, error.message || error);
            return {
                success: false,
                delivered: false,
                error: `Network failure connecting to Fast2SMS: ${error.message}`
            };
        }
    }

    // 2. Twilio Provider Integration (Alternative international/India SMS provider)
    if (provider === "twilio") {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;

        if (!accountSid || !authToken || !fromNumber) {
            console.warn(
                `⚠️ [SMS Service] Twilio credentials missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER). ` +
                `Event: ${eventType}, Recipient: +91${normalizedPhone}. SMS not delivered.`
            );
            return {
                success: false,
                delivered: false,
                error: "Twilio credentials not configured"
            };
        }

        try {
            const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
            const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
            const bodyParams = new URLSearchParams({
                To: `+91${normalizedPhone}`,
                From: fromNumber,
                Body: message
            });

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${credentials}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: bodyParams.toString()
            });

            const data = await response.json().catch(() => null);

            if (response.ok && data && data.sid) {
                console.log(
                    `✅ [SMS Service] Twilio sent successfully to +91${normalizedPhone} [${eventType}]. SID: ${data.sid}`
                );
                return {
                    success: true,
                    delivered: true,
                    messageId: data.sid
                };
            } else {
                const errMsg = data?.message || response.statusText || "Twilio rejected message";
                console.error(
                    `❌ [SMS Service] Twilio API error (${response.status}): ${errMsg}`
                );
                return {
                    success: false,
                    delivered: false,
                    error: `Twilio error: ${errMsg}`
                };
            }
        } catch (error) {
            console.error(`❌ [SMS Service] Twilio network error:`, error.message || error);
            return {
                success: false,
                delivered: false,
                error: `Network failure connecting to Twilio: ${error.message}`
            };
        }
    }

    return {
        success: false,
        delivered: false,
        error: `Unsupported SMS provider: ${provider}`
    };
};

// =========================================================================
// Specialized Event Notification Helpers (13 AgriRent SMS Events)
// =========================================================================

/**
 * Event 1: Booking request received by owner
 */
export const sendBookingRequestSMS = async ({ ownerPhone, ownerName, equipmentName, bookingId }) => {
    return sendSMS({
        phone: ownerPhone,
        eventType: "BOOKING_REQUEST_RECEIVED",
        message: `AgriRent: Hello ${ownerName || "Owner"}, you received a new booking request for "${equipmentName || "Equipment"}" (Booking #${bookingId}). Please accept or reject within 4 hours.`
    });
};

/**
 * Event 2: Booking reminder after 2 hours to owner
 */
export const sendBookingReminderSMS = async ({ ownerPhone, ownerName, bookingId, equipmentName }) => {
    return sendSMS({
        phone: ownerPhone,
        eventType: "BOOKING_2HR_REMINDER",
        message: `AgriRent Reminder: Hello ${ownerName || "Owner"}, Booking #${bookingId} for "${equipmentName || "Equipment"}" is pending your response. Please accept or reject within the next 2 hours, or it will be auto-cancelled.`
    });
};

/**
 * Event 3: Booking automatically cancelled after 4 hours
 */
export const sendBookingAutoCancelledSMS = async ({ recipientPhone, recipientName, recipientRole, bookingId, equipmentName }) => {
    const isOwner = recipientRole === "OWNER";
    const message = isOwner
        ? `AgriRent Alert: Booking #${bookingId} for "${equipmentName || "Equipment"}" was automatically cancelled because no response was provided within 4 hours.`
        : `AgriRent Notice: Your booking request #${bookingId} for "${equipmentName || "Equipment"}" has been automatically cancelled because the owner did not respond within 4 hours. You can explore other available equipment.`;

    return sendSMS({
        phone: recipientPhone,
        eventType: `BOOKING_AUTO_CANCELLED_${recipientRole}`,
        message
    });
};

/**
 * Event 4: Owner accepts booking
 */
export const sendBookingAcceptedSMS = async ({ farmerPhone, farmerName, equipmentName, bookingId, advanceAmount }) => {
    return sendSMS({
        phone: farmerPhone,
        eventType: "BOOKING_ACCEPTED",
        message: `AgriRent: Hello ${farmerName || "Farmer"}, your booking #${bookingId} for "${equipmentName || "Equipment"}" has been ACCEPTED by the owner. Please submit the advance payment of Rs. ${advanceAmount || ""} within 6 hours to confirm.`
    });
};

/**
 * Event 5: Owner rejects booking
 */
export const sendBookingRejectedSMS = async ({ farmerPhone, farmerName, equipmentName, bookingId, reason }) => {
    return sendSMS({
        phone: farmerPhone,
        eventType: "BOOKING_REJECTED",
        message: `AgriRent: Hello ${farmerName || "Farmer"}, your booking #${bookingId} for "${equipmentName || "Equipment"}" was rejected by the owner. Reason: ${reason || "Not specified"}.`
    });
};

/**
 * Event 6: Farmer submits advance payment
 */
export const sendPaymentSubmittedSMS = async ({ ownerPhone, ownerName, bookingId, amount, transactionId }) => {
    return sendSMS({
        phone: ownerPhone,
        eventType: "PAYMENT_SUBMITTED",
        message: `AgriRent: Farmer submitted advance payment of Rs. ${amount} for Booking #${bookingId} (Txn: ${transactionId}). Please verify this payment in your AgriRent portal.`
    });
};

/**
 * Event 7: Owner verifies advance payment
 */
export const sendPaymentVerifiedSMS = async ({ farmerPhone, farmerName, bookingId, amount }) => {
    return sendSMS({
        phone: farmerPhone,
        eventType: "PAYMENT_VERIFIED",
        message: `AgriRent: Great news ${farmerName || "Farmer"}! Your advance payment of Rs. ${amount} for Booking #${bookingId} has been verified by the owner. Your booking is now CONFIRMED.`
    });
};

/**
 * Event 8: Owner rejects payment
 */
export const sendPaymentRejectedSMS = async ({ farmerPhone, farmerName, bookingId, reason, amount }) => {
    return sendSMS({
        phone: farmerPhone,
        eventType: "PAYMENT_REJECTED",
        message: `AgriRent: Your payment submission for Booking #${bookingId} was rejected. Reason: ${reason || "Unverified"}. A refund of Rs. ${amount} has been marked as required.`
    });
};

/**
 * Event 9: Owner initiates refund
 */
export const sendRefundInitiatedSMS = async ({ farmerPhone, farmerName, bookingId, amount, refundTransactionId }) => {
    return sendSMS({
        phone: farmerPhone,
        eventType: "REFUND_INITIATED",
        message: `AgriRent: The owner has initiated a refund of Rs. ${amount} for Booking #${bookingId} (Txn: ${refundTransactionId}). Please verify receipt and confirm in your portal within 24 hours.`
    });
};

/**
 * Event 10: Farmer receives refund reminder / deadline notification
 */
export const sendRefundReminderSMS = async ({ farmerPhone, farmerName, bookingId, amount }) => {
    return sendSMS({
        phone: farmerPhone,
        eventType: "REFUND_REMINDER",
        message: `AgriRent Reminder: Hello ${farmerName || "Farmer"}, please confirm whether you received your refund of Rs. ${amount} for Booking #${bookingId}. If you did not receive it, you may raise a dispute.`
    });
};

/**
 * Event 11: Farmer raises refund dispute
 */
export const sendRefundDisputeSMS = async ({ recipientPhone, recipientName, bookingId, disputeReason }) => {
    return sendSMS({
        phone: recipientPhone,
        eventType: "REFUND_DISPUTE_RAISED",
        message: `AgriRent Dispute Notice: A refund dispute has been raised for Booking #${bookingId}. Reason: "${disputeReason}". An Area Admin has been assigned to investigate.`
    });
};

/**
 * Event 12: Area Admin receives dispute notification
 */
export const sendAreaAdminDisputeSMS = async ({ adminPhone, adminName, bookingId, disputeId, disputeReason }) => {
    return sendSMS({
        phone: adminPhone,
        eventType: "AREA_ADMIN_DISPUTE_ASSIGNED",
        message: `AgriRent Admin Alert: Hello ${adminName || "Area Admin"}, new refund dispute #${disputeId} assigned in your area for Booking #${bookingId}. Reason: "${disputeReason}". Please investigate.`
    });
};

/**
 * Event 13: Super Admin receives escalated dispute notification
 */
export const sendSuperAdminEscalationSMS = async ({ superAdminPhone, superAdminName, disputeId, bookingId, reason }) => {
    return sendSMS({
        phone: superAdminPhone,
        eventType: "SUPER_ADMIN_ESCALATION",
        message: `AgriRent Urgent: Dispute #${disputeId} for Booking #${bookingId} has been escalated to Super Admin after exceeding the resolution deadline. Reason: "${reason}".`
    });
};

/**
 * Inspection Event: Initial or Final Inspection submitted by counterpart
 */
export const sendInspectionSubmittedSMS = async ({ recipientPhone, recipientName, bookingId, stage, inspectorRole }) => {
    const stageName = stage === "INITIAL" ? "Pre-Handover" : "Post-Return";
    return sendSMS({
        phone: recipientPhone,
        eventType: `INSPECTION_${stage}_SUBMITTED`,
        message: `AgriRent Inspection: The ${inspectorRole.toLowerCase()} has submitted the ${stageName} inspection for Booking #${bookingId}. Please review and submit your confirmation.`
    });
};

/**
 * Inspection Event: Both parties confirmed initial inspection -> Equipment handed over, rental active
 */
export const sendHandoverCompletedSMS = async ({ recipientPhone, recipientName, bookingId, equipmentName }) => {
    return sendSMS({
        phone: recipientPhone,
        eventType: "EQUIPMENT_HANDOVER_COMPLETED",
        message: `AgriRent Handover: Pre-handover inspection for "${equipmentName}" (Booking #${bookingId}) has been confirmed by both parties. Handover is complete and the rental is now ACTIVE.`
    });
};

/**
 * Inspection Event: Return completed without damage
 */
export const sendReturnCompletedSMS = async ({ recipientPhone, recipientName, bookingId, equipmentName }) => {
    return sendSMS({
        phone: recipientPhone,
        eventType: "EQUIPMENT_RETURN_COMPLETED",
        message: `AgriRent Return: Return inspection for "${equipmentName}" (Booking #${bookingId}) has been confirmed by both parties. Equipment returned in good condition. Booking is COMPLETED.`
    });
};

/**
 * Inspection Event: Damage reported during return
 */
export const sendReturnDamageDisputeSMS = async ({ recipientPhone, recipientName, bookingId, equipmentName, damageDescription }) => {
    return sendSMS({
        phone: recipientPhone,
        eventType: "EQUIPMENT_RETURN_DAMAGED",
        message: `AgriRent Damage Alert: Damage reported during return of "${equipmentName}" (Booking #${bookingId}): "${damageDescription || "Damage reported"}". Case is placed under inspection review.`
    });
};

export default {
    sendSMS,
    normalizePhoneNumber,
    sendBookingRequestSMS,
    sendBookingReminderSMS,
    sendBookingAutoCancelledSMS,
    sendBookingAcceptedSMS,
    sendBookingRejectedSMS,
    sendPaymentSubmittedSMS,
    sendPaymentVerifiedSMS,
    sendPaymentRejectedSMS,
    sendRefundInitiatedSMS,
    sendRefundReminderSMS,
    sendRefundDisputeSMS,
    sendAreaAdminDisputeSMS,
    sendSuperAdminEscalationSMS,
    sendInspectionSubmittedSMS,
    sendHandoverCompletedSMS,
    sendReturnCompletedSMS,
    sendReturnDamageDisputeSMS
};
