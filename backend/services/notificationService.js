import { sendEmail, isValidEmail } from "./emailService.js";

/**
 * AgriRent Notification Service
 * Replaces legacy SMS notifications with Brevo Transactional Email API.
 * All notification dispatches are non-blocking and safe against external API errors.
 */

// =========================================================================
// 1. AUTHENTICATION & SECURITY NOTIFICATIONS
// =========================================================================

/**
 * Registration Verification OTP Email
 */
export const sendOTPEmail = async ({ email, name, otp }) => {
  return sendEmail({
    to: email,
    toName: name || "User",
    subject: "AgriRent Registration Verification OTP",
    template: "otpEmail.html",
    templateData: {
      title: "Verify Your AgriRent Account",
      purposeMessage: "Thank you for registering with AgriRent! Use the verification code below to complete your registration.",
      otp
    }
  });
};

/**
 * Registration Confirmation / Welcome Email
 */
export const sendRegistrationConfirmationEmail = async ({ email, name, role }) => {
  return sendEmail({
    to: email,
    toName: name || "User",
    subject: "Welcome to AgriRent! Your Account is Activated",
    template: "bookingNotification.html",
    templateData: {
      title: "Account Activated",
      badgeClass: "badge-success",
      statusTitle: "Registration Successful",
      statusMessage: `Welcome to AgriRent, ${name || "User"}! Your ${role || "member"} account has been verified and activated. You now have full access to agricultural equipment rentals.`,
      bookingId: "N/A",
      equipmentName: "Platform Services",
      startDate: "N/A",
      endDate: "N/A",
      totalAmount: "N/A",
      alertBoxClass: "info-box",
      actionGuidance: "You can now log in, explore verified equipment, manage bookings, and coordinate secure rentals."
    }
  });
};

/**
 * Password Reset OTP Email
 */
export const sendPasswordResetOTPEmail = async ({ email, name, otp }) => {
  return sendEmail({
    to: email,
    toName: name || "User",
    subject: "AgriRent Password Reset OTP",
    template: "otpEmail.html",
    templateData: {
      title: "Reset Your AgriRent Password",
      purposeMessage: "We received a request to reset your AgriRent account password. Use the verification code below to verify your request.",
      otp
    }
  });
};

/**
 * Password Reset Success Confirmation Email
 */
export const sendPasswordResetSuccessEmail = async ({ email, name }) => {
  return sendEmail({
    to: email,
    toName: name || "User",
    subject: "Your AgriRent Password Has Been Reset",
    template: "accountActionNotification.html",
    templateData: {
      title: "Password Reset Successful",
      badgeClass: "badge-success",
      actionTitle: "Password Updated",
      actionMessage: "Your AgriRent account password was successfully updated.",
      accountStatus: "Active",
      effectiveDate: new Date().toLocaleString(),
      reason: "User requested password reset via verified OTP",
      alertBoxClass: "info-box",
      actionGuidance: "If you did not make this change, please contact AgriRent support immediately to secure your account."
    }
  });
};

// =========================================================================
// 2. BOOKING LIFECYCLE NOTIFICATIONS
// =========================================================================

/**
 * Event 1: Booking request received by owner
 */
export const sendBookingRequestEmail = async ({ ownerEmail, ownerName, equipmentName, bookingId, totalAmount, advanceAmount }) => {
  return sendEmail({
    to: ownerEmail,
    toName: ownerName || "Equipment Owner",
    subject: `New Booking Request #${bookingId} - AgriRent`,
    template: "bookingNotification.html",
    templateData: {
      title: "New Booking Request",
      badgeClass: "badge-info",
      statusTitle: "Booking Requested",
      statusMessage: `You have received a new booking request for "${equipmentName || "Equipment"}". Please review and respond within 4 hours.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      startDate: "Scheduled Date",
      endDate: "Return Date",
      totalAmount: totalAmount || "N/A",
      advanceRow: advanceAmount ? true : false,
      advanceAmount: advanceAmount || "",
      alertBoxClass: "warning-box",
      actionGuidance: "Please accept or reject this request within 4 hours. If no response is provided, the booking will be automatically cancelled."
    }
  });
};

/**
 * Event 2: Booking reminder after 2 hours to owner
 */
export const sendBookingReminderEmail = async ({ ownerEmail, ownerName, bookingId, equipmentName }) => {
  return sendEmail({
    to: ownerEmail,
    toName: ownerName || "Equipment Owner",
    subject: `Reminder: Booking Request #${bookingId} Expiring Soon - AgriRent`,
    template: "bookingNotification.html",
    templateData: {
      title: "Booking Response Reminder",
      badgeClass: "badge-warning",
      statusTitle: "Response Pending (2 Hours Left)",
      statusMessage: `Booking #${bookingId} for "${equipmentName || "Equipment"}" is awaiting your approval.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      startDate: "Scheduled Date",
      endDate: "Return Date",
      totalAmount: "N/A",
      alertBoxClass: "alert-box",
      actionGuidance: "Only 2 hours remain to respond before the system automatically cancels this booking request."
    }
  });
};

/**
 * Event 3: Booking automatically cancelled after 4 hours
 */
export const sendBookingAutoCancelledEmail = async ({ recipientEmail, recipientName, recipientRole, bookingId, equipmentName }) => {
  const isOwner = recipientRole === "OWNER";
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Booking #${bookingId} Automatically Cancelled - AgriRent`,
    template: "bookingNotification.html",
    templateData: {
      title: "Booking Auto-Cancelled",
      badgeClass: "badge-danger",
      statusTitle: "Cancelled (Expired)",
      statusMessage: isOwner
        ? `Booking #${bookingId} for "${equipmentName || "Equipment"}" was automatically cancelled because no response was provided within the 4-hour window.`
        : `Your booking request #${bookingId} for "${equipmentName || "Equipment"}" was automatically cancelled because the owner did not respond within 4 hours. You can explore other available equipment on AgriRent.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      startDate: "N/A",
      endDate: "N/A",
      totalAmount: "0",
      cancellationReasonRow: true,
      cancellationReason: "Owner response timeout (4 hours expired)",
      alertBoxClass: "info-box",
      actionGuidance: isOwner
        ? "Please monitor booking requests promptly to maintain a high response score."
        : "You can browse similar equipment in your area with instant availability."
    }
  });
};

/**
 * Event: Equipment verification or status updated
 */
export const sendEquipmentStatusEmail = async ({ ownerEmail, ownerName, equipmentName, status, verificationStatus, remarks }) => {
  const isVerified = verificationStatus === "VERIFIED";
  return sendEmail({
    to: ownerEmail,
    toName: ownerName || "Equipment Owner",
    subject: `Equipment Verification Update: "${equipmentName || "Equipment"}" - ${verificationStatus || status} - AgriRent`,
    template: "bookingNotification.html",
    templateData: {
      title: `Equipment ${verificationStatus || status}`,
      badgeClass: isVerified ? "badge-success" : "badge-danger",
      statusTitle: `Verification Status: ${verificationStatus || status}`,
      statusMessage: isVerified
        ? `Congratulations! Your equipment "${equipmentName || "Equipment"}" has been verified and is now available for farmer bookings on AgriRent.`
        : `Your equipment "${equipmentName || "Equipment"}" verification was not approved. ${remarks || "Please review equipment details and compliance standards."}`,
      bookingId: "N/A",
      equipmentName: equipmentName || "Agricultural Equipment",
      startDate: "N/A",
      endDate: "N/A",
      totalAmount: "N/A",
      alertBoxClass: isVerified ? "info-box" : "alert-box",
      actionGuidance: isVerified
        ? "Ensure equipment remains maintained and ready for inspections."
        : "You may contact your local Area Administrator for guidance."
    }
  });
};

/**
 * Event: Booking manually cancelled by Farmer or Admin
 */
export const sendBookingCancelledEmail = async ({ recipientEmail, recipientName, recipientRole, bookingId, equipmentName, reason }) => {
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Booking #${bookingId} Cancelled - AgriRent`,
    template: "bookingNotification.html",
    templateData: {
      title: "Booking Cancelled",
      badgeClass: "badge-danger",
      statusTitle: "Cancelled",
      statusMessage: `Booking #${bookingId} for "${equipmentName || "Equipment"}" has been cancelled.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      startDate: "N/A",
      endDate: "N/A",
      totalAmount: "0",
      cancellationReasonRow: true,
      cancellationReason: reason || "Cancelled by user",
      alertBoxClass: "info-box",
      actionGuidance: "If an advance payment was already submitted, refund processing will be initiated according to policy."
    }
  });
};

/**
 * Event 4: Owner accepts booking
 */
export const sendBookingAcceptedEmail = async ({ farmerEmail, farmerName, equipmentName, bookingId, advanceAmount }) => {
  return sendEmail({
    to: farmerEmail,
    toName: farmerName || "Farmer",
    subject: `Booking #${bookingId} Accepted - Advance Payment Required - AgriRent`,
    template: "bookingNotification.html",
    templateData: {
      title: "Booking Accepted",
      badgeClass: "badge-success",
      statusTitle: "Accepted by Owner",
      statusMessage: `Great news! Your booking #${bookingId} for "${equipmentName || "Equipment"}" has been accepted by the owner.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      startDate: "Scheduled Date",
      endDate: "Return Date",
      totalAmount: "N/A",
      advanceRow: true,
      advanceAmount: advanceAmount || "",
      alertBoxClass: "info-box",
      actionGuidance: `Please submit the 20% advance payment (₹${advanceAmount}) within 6 hours to confirm this booking reservation.`
    }
  });
};

/**
 * Event 5: Owner rejects booking
 */
export const sendBookingRejectedEmail = async ({ farmerEmail, farmerName, equipmentName, bookingId, reason }) => {
  return sendEmail({
    to: farmerEmail,
    toName: farmerName || "Farmer",
    subject: `Booking #${bookingId} Update - AgriRent`,
    template: "bookingNotification.html",
    templateData: {
      title: "Booking Request Declined",
      badgeClass: "badge-danger",
      statusTitle: "Declined by Owner",
      statusMessage: `Your booking request #${bookingId} for "${equipmentName || "Equipment"}" was declined by the owner.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      startDate: "N/A",
      endDate: "N/A",
      totalAmount: "0",
      cancellationReasonRow: true,
      cancellationReason: reason || "Owner unavailable during requested period",
      alertBoxClass: "warning-box",
      actionGuidance: "You can find and book other equipment available in your area on AgriRent."
    }
  });
};

// =========================================================================
// 3. PAYMENT & REFUND NOTIFICATIONS
// =========================================================================

/**
 * Event 6: Farmer submits advance payment
 */
export const sendPaymentSubmittedEmail = async ({ ownerEmail, ownerName, bookingId, amount, transactionId, equipmentName }) => {
  return sendEmail({
    to: ownerEmail,
    toName: ownerName || "Equipment Owner",
    subject: `Advance Payment Submitted for Booking #${bookingId} - AgriRent`,
    template: "paymentNotification.html",
    templateData: {
      title: "Advance Payment Received",
      badgeClass: "badge-info",
      paymentTitle: "Payment Submitted by Farmer",
      paymentMessage: `Farmer has submitted an advance payment of ₹${amount} for Booking #${bookingId}. Please verify the transaction.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      paymentType: "20% Advance Payment",
      amount,
      transactionIdRow: true,
      transactionId: transactionId || "Pending Verification",
      alertBoxClass: "info-box",
      actionGuidance: "Log into AgriRent and verify whether this advance payment reflects in your account."
    }
  });
};

/**
 * Event 7: Owner verifies advance payment
 */
export const sendPaymentVerifiedEmail = async ({ farmerEmail, farmerName, bookingId, amount, equipmentName }) => {
  return sendEmail({
    to: farmerEmail,
    toName: farmerName || "Farmer",
    subject: `Payment Verified - Booking #${bookingId} Confirmed - AgriRent`,
    template: "paymentNotification.html",
    templateData: {
      title: "Payment Verified",
      badgeClass: "badge-success",
      paymentTitle: "Booking Confirmed",
      paymentMessage: `Your advance payment of ₹${amount} for Booking #${bookingId} has been verified by the owner. Your booking is now CONFIRMED.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      paymentType: "20% Advance Payment",
      amount,
      alertBoxClass: "info-box",
      actionGuidance: "Prepare for equipment pickup and pre-rental inspection on the scheduled start date."
    }
  });
};

/**
 * Event 8: Owner rejects payment
 */
export const sendPaymentRejectedEmail = async ({ farmerEmail, farmerName, bookingId, reason, amount, equipmentName }) => {
  return sendEmail({
    to: farmerEmail,
    toName: farmerName || "Farmer",
    subject: `Payment Verification Issue - Booking #${bookingId} - AgriRent`,
    template: "paymentNotification.html",
    templateData: {
      title: "Payment Rejected",
      badgeClass: "badge-danger",
      paymentTitle: "Payment Not Verified",
      paymentMessage: `The owner was unable to verify your advance payment of ₹${amount} for Booking #${bookingId}.`,
      bookingId,
      equipmentName: equipmentName || "Agricultural Equipment",
      paymentType: "Advance Payment",
      amount,
      alertBoxClass: "alert-box",
      actionGuidance: `Reason provided: "${reason || "Invalid transaction reference"}". A refund process has been initiated if funds were deducted.`
    }
  });
};

/**
 * Event 9: Owner initiates refund
 */
export const sendRefundInitiatedEmail = async ({ farmerEmail, farmerName, bookingId, amount, refundTransactionId }) => {
  return sendEmail({
    to: farmerEmail,
    toName: farmerName || "Farmer",
    subject: `Refund Initiated for Booking #${bookingId} - AgriRent`,
    template: "refundNotification.html",
    templateData: {
      title: "Refund Initiated",
      badgeClass: "badge-info",
      refundTitle: "Refund Submitted by Owner",
      refundMessage: `The equipment owner has recorded a refund of ₹${amount} for Booking #${bookingId}.`,
      bookingId,
      refundAmount: amount,
      refundRefRow: true,
      refundReference: refundTransactionId || "Bank UTR Transfer",
      deadlineRow: true,
      deadline: "24 Hours from Notice",
      alertBoxClass: "warning-box",
      actionGuidance: "Please check your bank account and confirm receipt in your AgriRent portal. If not received within 24 hours, you may raise a dispute."
    }
  });
};

/**
 * Event 10: Farmer receives refund reminder / deadline notification
 */
export const sendRefundReminderEmail = async ({ farmerEmail, farmerName, bookingId, amount }) => {
  return sendEmail({
    to: farmerEmail,
    toName: farmerName || "Farmer",
    subject: `Reminder: Confirm Refund Receipt for Booking #${bookingId} - AgriRent`,
    template: "refundNotification.html",
    templateData: {
      title: "Refund Confirmation Reminder",
      badgeClass: "badge-warning",
      refundTitle: "Confirmation Pending",
      refundMessage: `Please confirm whether you received the refund of ₹${amount} for Booking #${bookingId}.`,
      bookingId,
      refundAmount: amount,
      alertBoxClass: "warning-box",
      actionGuidance: "Confirm receipt if credited. If you have not received the funds, raise a dispute before the deadline."
    }
  });
};

/**
 * Event 11: Farmer raises refund dispute
 */
export const sendRefundDisputeEmail = async ({ recipientEmail, recipientName, bookingId, disputeReason }) => {
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Dispute Notice - Booking #${bookingId} - AgriRent`,
    template: "disputeNotification.html",
    templateData: {
      title: "Refund Dispute Raised",
      badgeClass: "badge-danger",
      disputeTitle: "Dispute Under Investigation",
      disputeMessage: `A dispute has been raised regarding the refund for Booking #${bookingId}. An Area Admin has been assigned to investigate.`,
      disputeId: `DSP-BKG-${bookingId}`,
      bookingId,
      stage: "Area Admin Investigation",
      reasonRow: true,
      reason: disputeReason || "Refund not credited to account",
      alertBoxClass: "warning-box",
      actionGuidance: "Please have your bank statement or transaction proof ready for the Area Admin."
    }
  });
};

// =========================================================================
// 4. INSPECTION & HANDOVER NOTIFICATIONS
// =========================================================================

/**
 * Inspection Event: Initial or Final Inspection submitted
 */
export const sendInspectionSubmittedEmail = async ({ recipientEmail, recipientName, bookingId, stage, inspectorRole }) => {
  const stageName = stage === "INITIAL" ? "Pre-Handover" : "Post-Return";
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `${stageName} Inspection Submitted - Booking #${bookingId} - AgriRent`,
    template: "inspectionNotification.html",
    templateData: {
      title: `${stageName} Inspection Recorded`,
      badgeClass: "badge-info",
      inspectionTitle: "Inspection Submitted",
      inspectionMessage: `The ${inspectorRole.toLowerCase()} has submitted the ${stageName} inspection report for Booking #${bookingId}.`,
      bookingId,
      inspectionType: stageName,
      status: "Awaiting Confirmation",
      alertBoxClass: "info-box",
      actionGuidance: "Review the checklist, photos, and meter reading. Submit your confirmation in the AgriRent app."
    }
  });
};

/**
 * Inspection Event: Both parties confirmed initial inspection -> Equipment handed over
 */
export const sendHandoverCompletedEmail = async ({ recipientEmail, recipientName, bookingId, equipmentName }) => {
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Handover Complete - Rental is Now ACTIVE - Booking #${bookingId} - AgriRent`,
    template: "inspectionNotification.html",
    templateData: {
      title: "Equipment Handover Confirmed",
      badgeClass: "badge-success",
      inspectionTitle: "Rental Active",
      inspectionMessage: `Pre-handover inspection for "${equipmentName || "Equipment"}" (Booking #${bookingId}) has been confirmed by both parties. Handover is complete!`,
      bookingId,
      inspectionType: "Pre-Handover Handover",
      status: "ACTIVE",
      alertBoxClass: "info-box",
      actionGuidance: "Equipment is now officially in service. Operate safely and ensure return by the scheduled date."
    }
  });
};

/**
 * Inspection Event: Return completed without damage
 */
export const sendReturnCompletedEmail = async ({ recipientEmail, recipientName, bookingId, equipmentName }) => {
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Equipment Return Confirmed - Booking #${bookingId} COMPLETED - AgriRent`,
    template: "inspectionNotification.html",
    templateData: {
      title: "Return Inspection Completed",
      badgeClass: "badge-success",
      inspectionTitle: "Booking Completed",
      inspectionMessage: `Return inspection for "${equipmentName || "Equipment"}" (Booking #${bookingId}) has been verified. Equipment returned in good condition.`,
      bookingId,
      inspectionType: "Post-Rental Return",
      status: "COMPLETED",
      alertBoxClass: "info-box",
      actionGuidance: "Thank you for partnering with AgriRent. We appreciate your prompt handover and rental care."
    }
  });
};

/**
 * Inspection Event: Damage reported during return
 */
export const sendReturnDamageDisputeEmail = async ({ recipientEmail, recipientName, bookingId, equipmentName, damageDescription }) => {
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Damage Reported - Return Inspection Flagged - Booking #${bookingId} - AgriRent`,
    template: "inspectionNotification.html",
    templateData: {
      title: "Return Damage Flagged",
      badgeClass: "badge-danger",
      inspectionTitle: "Inspection Flagged",
      inspectionMessage: `Damage has been reported during return of "${equipmentName || "Equipment"}" for Booking #${bookingId}.`,
      bookingId,
      inspectionType: "Post-Rental Return (Disputed)",
      status: "UNDER_REVIEW",
      notesRow: true,
      notes: damageDescription || "Damage reported during handover return",
      alertBoxClass: "alert-box",
      actionGuidance: "Case has been referred for review. Inspection photos and logs are locked to prevent deletion."
    }
  });
};

// =========================================================================
// 5. ADMINISTRATIVE & DISPUTE RESOLUTION NOTIFICATIONS
// =========================================================================

/**
 * Event 12: Area Admin receives dispute notification
 */
export const sendAreaAdminDisputeEmail = async ({ adminEmail, adminName, bookingId, disputeId, disputeReason }) => {
  return sendEmail({
    to: adminEmail,
    toName: adminName || "Area Administrator",
    subject: `Dispute Assigned #${disputeId} (Booking #${bookingId}) - AgriRent Admin`,
    template: "disputeNotification.html",
    templateData: {
      title: "Dispute Case Assigned",
      badgeClass: "badge-warning",
      disputeTitle: "Area Investigation Assigned",
      disputeMessage: `A new dispute has been assigned to your jurisdiction for Booking #${bookingId}.`,
      disputeId,
      bookingId,
      stage: "Area Admin Investigation",
      reasonRow: true,
      reason: disputeReason || "Dispute raised by party",
      alertBoxClass: "warning-box",
      actionGuidance: "Inspect photos, transaction proofs, interview parties, and file investigation report within 48 hours."
    }
  });
};

/**
 * Event 13: Super Admin receives escalated dispute notification
 */
export const sendSuperAdminEscalationEmail = async ({ superAdminEmail, superAdminName, disputeId, bookingId, reason }) => {
  return sendEmail({
    to: superAdminEmail,
    toName: superAdminName || "Super Administrator",
    subject: `URGENT: Dispute Escalation #${disputeId} - AgriRent`,
    template: "disputeNotification.html",
    templateData: {
      title: "Dispute Escalated to Super Admin",
      badgeClass: "badge-danger",
      disputeTitle: "Escalated for Final Ruling",
      disputeMessage: `Dispute #${disputeId} for Booking #${bookingId} has been escalated for Super Admin final resolution.`,
      disputeId,
      bookingId,
      stage: "Super Admin Final Resolution",
      reasonRow: true,
      reason: reason || "Investigation escalated or deadline elapsed",
      alertBoxClass: "alert-box",
      actionGuidance: "Review complete audit trail, inspection history, and issue final binding ruling."
    }
  });
};

/**
 * Super Admin Decision Event: Decision issued on escalated dispute
 */
export const sendSuperAdminDisputeDecisionEmail = async ({ recipientEmail, recipientName, disputeId, bookingId, decision, remarks }) => {
  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Official Decision: Dispute #${disputeId} - AgriRent`,
    template: "disputeNotification.html",
    templateData: {
      title: "Super Admin Final Resolution",
      badgeClass: "badge-success",
      disputeTitle: "Final Ruling Issued",
      disputeMessage: `Super Admin has rendered an official final decision regarding Dispute #${disputeId} (Booking #${bookingId}).`,
      disputeId,
      bookingId,
      stage: "Resolved",
      decisionRow: true,
      decision: decision || "RESOLVED",
      reasonRow: remarks ? true : false,
      reason: remarks || "Ruling finalized by Super Administration",
      alertBoxClass: "info-box",
      actionGuidance: "This decision is final and binding on the AgriRent platform."
    }
  });
};

/**
 * Super Admin Remand Event: Additional evidence/investigation requested
 */
export const sendAdditionalEvidenceRequestedEmail = async ({ adminEmail, adminName, disputeId, bookingId, instructions }) => {
  return sendEmail({
    to: adminEmail,
    toName: adminName || "Area Administrator",
    subject: `Action Required: Additional Evidence Needed for Dispute #${disputeId} - AgriRent`,
    template: "disputeNotification.html",
    templateData: {
      title: "Dispute Remanded for Evidence",
      badgeClass: "badge-warning",
      disputeTitle: "Additional Evidence Requested",
      disputeMessage: `Super Admin has remanded Dispute #${disputeId} (Booking #${bookingId}) for further investigation.`,
      disputeId,
      bookingId,
      stage: "Area Admin Further Investigation",
      reasonRow: true,
      reason: instructions || "Please collect additional statements and evidence",
      alertBoxClass: "warning-box",
      actionGuidance: "Please gather the requested evidence and re-submit the case promptly."
    }
  });
};

/**
 * Account Action Event: Warning, suspension, block, reactivation
 */
export const sendAccountActionEmail = async ({ recipientEmail, recipientName, actionType, reason, duration }) => {
  const isSuspension = actionType.includes("SUSPEND") || actionType.includes("BLOCK");
  const badgeClass = isSuspension ? "badge-danger" : actionType.includes("REACTIVATE") ? "badge-success" : "badge-warning";
  const alertBoxClass = isSuspension ? "alert-box" : actionType.includes("REACTIVATE") ? "info-box" : "warning-box";

  return sendEmail({
    to: recipientEmail,
    toName: recipientName || "User",
    subject: `Important Account Notification: ${actionType} - AgriRent`,
    template: "accountActionNotification.html",
    templateData: {
      title: "Account Status Update",
      badgeClass,
      actionTitle: `Account ${actionType}`,
      actionMessage: `An administrative action (${actionType}) has been applied to your AgriRent account.`,
      accountStatus: actionType,
      effectiveDate: new Date().toLocaleDateString(),
      reason: reason || "Platform policy adherence",
      alertBoxClass,
      actionGuidance: isSuspension
        ? "Access to certain platform functions is restricted. Contact support if you wish to appeal."
        : "Please ensure continued compliance with AgriRent policies and rental agreements."
    }
  });
};

// =========================================================================
// BACKWARD-COMPATIBLE ADAPTERS (Delegating to Email)
// =========================================================================
export const sendSMS = async (params) => {
  // If phone is passed, log migration notice and deliver to email if email present
  if (params?.email) {
    return sendEmail({
      to: params.email,
      toName: params.recipientName || "User",
      subject: "AgriRent Notification",
      htmlContent: `<p>${params.message || ""}</p>`
    });
  }
  return { success: true, delivered: false, note: "SMS disabled; Brevo email is active notification channel" };
};

export const normalizePhoneNumber = (phone) => {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[\s\-\(\)]/g, "");
  const match = cleaned.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  return match ? match[1] : null;
};

// Map legacy function names to email equivalents
export const sendOTPSMS = ({ phone, email, otp, name }) => sendOTPEmail({ email, name, otp });
export const sendPasswordResetOTPSMS = ({ phone, email, otp, name }) => sendPasswordResetOTPEmail({ email, name, otp });
export const sendPasswordResetSuccessSMS = ({ phone, email, userName, name }) => sendPasswordResetSuccessEmail({ email, name: name || userName });
export const sendBookingRequestSMS = (args) => sendBookingRequestEmail({ ...args, ownerEmail: args.ownerEmail || args.email });
export const sendBookingReminderSMS = (args) => sendBookingReminderEmail({ ...args, ownerEmail: args.ownerEmail || args.email });
export const sendBookingAutoCancelledSMS = (args) => sendBookingAutoCancelledEmail({ ...args, recipientEmail: args.recipientEmail || args.email });
export const sendBookingAcceptedSMS = (args) => sendBookingAcceptedEmail({ ...args, farmerEmail: args.farmerEmail || args.email });
export const sendBookingRejectedSMS = (args) => sendBookingRejectedEmail({ ...args, farmerEmail: args.farmerEmail || args.email });
export const sendPaymentSubmittedSMS = (args) => sendPaymentSubmittedEmail({ ...args, ownerEmail: args.ownerEmail || args.email });
export const sendPaymentVerifiedSMS = (args) => sendPaymentVerifiedEmail({ ...args, farmerEmail: args.farmerEmail || args.email });
export const sendPaymentRejectedSMS = (args) => sendPaymentRejectedEmail({ ...args, farmerEmail: args.farmerEmail || args.email });
export const sendRefundInitiatedSMS = (args) => sendRefundInitiatedEmail({ ...args, farmerEmail: args.farmerEmail || args.email });
export const sendRefundReminderSMS = (args) => sendRefundReminderEmail({ ...args, farmerEmail: args.farmerEmail || args.email });
export const sendRefundDisputeSMS = (args) => sendRefundDisputeEmail({ ...args, recipientEmail: args.recipientEmail || args.email });
export const sendAreaAdminDisputeSMS = (args) => sendAreaAdminDisputeEmail({ ...args, adminEmail: args.adminEmail || args.email });
export const sendSuperAdminEscalationSMS = (args) => sendSuperAdminEscalationEmail({ ...args, superAdminEmail: args.superAdminEmail || args.email });
export const sendInspectionSubmittedSMS = (args) => sendInspectionSubmittedEmail({ ...args, recipientEmail: args.recipientEmail || args.email });
export const sendHandoverCompletedSMS = (args) => sendHandoverCompletedEmail({ ...args, recipientEmail: args.recipientEmail || args.email });
export const sendReturnCompletedSMS = (args) => sendReturnCompletedEmail({ ...args, recipientEmail: args.recipientEmail || args.email });
export const sendReturnDamageDisputeSMS = (args) => sendReturnDamageDisputeEmail({ ...args, recipientEmail: args.recipientEmail || args.email });
export const sendSuperAdminDisputeDecisionSMS = (args) => sendSuperAdminDisputeDecisionEmail({ ...args, recipientEmail: args.recipientEmail || args.email });
export const sendAdditionalEvidenceRequestedSMS = (args) => sendAdditionalEvidenceRequestedEmail({ ...args, adminEmail: args.adminEmail || args.email });
export const sendAccountActionSMS = (args) => sendAccountActionEmail({ ...args, recipientEmail: args.recipientEmail || args.email });

export default {
  sendOTPEmail,
  sendRegistrationConfirmationEmail,
  sendPasswordResetOTPEmail,
  sendPasswordResetSuccessEmail,
  sendBookingRequestEmail,
  sendBookingReminderEmail,
  sendBookingCancelledEmail,
  sendBookingAutoCancelledEmail,
  sendBookingAcceptedEmail,
  sendBookingRejectedEmail,
  sendPaymentSubmittedEmail,
  sendPaymentVerifiedEmail,
  sendPaymentRejectedEmail,
  sendRefundInitiatedEmail,
  sendRefundReminderEmail,
  sendRefundDisputeEmail,
  sendAreaAdminDisputeEmail,
  sendSuperAdminEscalationEmail,
  sendInspectionSubmittedEmail,
  sendHandoverCompletedEmail,
  sendReturnCompletedEmail,
  sendReturnDamageDisputeEmail,
  sendSuperAdminDisputeDecisionEmail,
  sendAdditionalEvidenceRequestedEmail,
  sendAccountActionEmail,
  sendEquipmentStatusEmail,
  // Backward compatibility
  sendSMS,
  normalizePhoneNumber,
  sendOTPSMS,
  sendPasswordResetOTPSMS,
  sendPasswordResetSuccessSMS,
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
  sendReturnDamageDisputeSMS,
  sendSuperAdminDisputeDecisionSMS,
  sendAdditionalEvidenceRequestedSMS,
  sendAccountActionSMS
};
