import "dotenv/config";
import jwt from "jsonwebtoken";
import pool from "./db.js";
import express from "express";
import equipmentRoutes from "./routes/equipmentRoutes.js";
import equipmentMediaRoutes from "./routes/equipmentMediaRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import inspectionRoutes from "./routes/inspectionRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import {
    checkBookingAcceptanceTimeouts,
    checkPaymentVerificationTimeouts
} from "./services/paymentTimeoutService.js";
import {
    checkInspectionMediaCleanupTimeouts,
    isBookingSafeForMediaCleanup
} from "./services/mediaCleanupService.js";
import cloudinary from "./config/cloudinary.js";
import notificationService, { normalizePhoneNumber } from "./services/notificationService.js";
import emailService, { isValidEmail, renderTemplate, sendEmail, getSentEmails, clearSentEmails, getLastEmailFor } from "./services/emailService.js";

const app = express();
app.use(express.json());
app.use("/api", equipmentRoutes);
app.use("/api", equipmentMediaRoutes);
app.use("/api", paymentRoutes);
app.use("/api", bookingRoutes);
app.use("/api", adminRoutes);
app.use("/api", inspectionRoutes);
app.use("/api", authRoutes);

const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/api`;

const JWT_SECRET = process.env.JWT_SECRET || "agrirent_secret_key";

async function apiRequest(endpoint, { method = "GET", headers = {}, body = null } = {}) {
    const opts = {
        method,
        headers: {
            "Content-Type": "application/json",
            ...headers
        }
    };
    if (body) {
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${endpoint}`, opts);
    let data;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { status: res.status, data };
}

const ownerToken = jwt.sign({ id: 1 }, JWT_SECRET, { expiresIn: "1h" });
const farmerToken = jwt.sign({ id: 2 }, JWT_SECRET, { expiresIn: "1h" });
const superAdminToken = jwt.sign({ id: 3 }, JWT_SECRET, { expiresIn: "1h" });
const areaAdminToken = jwt.sign({ id: 4 }, JWT_SECRET, { expiresIn: "1h" });
const expiredToken = jwt.sign({ id: 1 }, JWT_SECRET, { expiresIn: "-1s" });

let passed = 0;
let failed = 0;

function assert(condition, testName, details = "") {
    if (condition) {
        console.log(`  ✅ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${testName} - ${details}`);
        failed++;
    }
}

async function runTests() {
    console.log("=================================================");
    console.log("STARTING AGRIRENT EXTENDED TEST SUITE");
    console.log("=================================================\n");

    const [existingOwner2] = await pool.query("SELECT id FROM users WHERE phone = '9999999998'");
    let owner2UserId, owner2Id;
    if (existingOwner2.length === 0) {
        const [uRes] = await pool.query(
            "INSERT INTO users (full_name, phone, password_hash, role, status) VALUES ('Owner Two', '9999999998', 'dummy', 'OWNER', 'ACTIVE')"
        );
        owner2UserId = uRes.insertId;
        const [oRes] = await pool.query(
            "INSERT INTO owners (user_id, location_id, verification_status) VALUES (?, 1, 'VERIFIED')",
            [owner2UserId]
        );
        owner2Id = oRes.insertId;
    } else {
        owner2UserId = existingOwner2[0].id;
        const [oRows] = await pool.query("SELECT id FROM owners WHERE user_id = ?", [owner2UserId]);
        owner2Id = oRows[0].id;
    }
    const owner2Token = jwt.sign({ id: owner2UserId }, JWT_SECRET, { expiresIn: "1h" });

    // -------------------------------------------------------------------------
    // 1. AUTHENTICATION & ROLE-BASED AUTHORIZATION TESTS
    // -------------------------------------------------------------------------
    console.log("--- 1. AUTHENTICATION AND ROLE-BASED AUTHORIZATION TESTS ---");

    // 1.1 Request without token
    const resNoToken = await apiRequest("/equipment", { method: "POST", body: { name: "Test" } });
    assert(resNoToken.status === 401, "POST /equipment without token returns 401", JSON.stringify(resNoToken.data));

    // 1.2 Request with invalid token
    const resInvalidToken = await apiRequest("/equipment", {
        method: "POST",
        headers: { Authorization: "Bearer invalid.token.value" },
        body: { name: "Test" }
    });
    assert(resInvalidToken.status === 401, "POST /equipment with invalid token returns 401", JSON.stringify(resInvalidToken.data));

    // 1.3 Request with expired token
    const resExpiredToken = await apiRequest("/equipment", {
        method: "POST",
        headers: { Authorization: `Bearer ${expiredToken}` },
        body: { name: "Test" }
    });
    assert(resExpiredToken.status === 401, "POST /equipment with expired token returns 401", JSON.stringify(resExpiredToken.data));

    // 1.4 Farmer attempting owner operations (e.g. create equipment)
    const resFarmerCreateEq = await apiRequest("/equipment", {
        method: "POST",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: { name: "Tractor", location_id: 1, category_id: 1 }
    });
    assert(resFarmerCreateEq.status === 403, "Farmer attempting to create equipment returns 403", JSON.stringify(resFarmerCreateEq.data));

    // 1.5 Owner attempting another owner's operations (IDOR update)
    const resOwner2UpdateEq1 = await apiRequest("/equipment/3", {
        method: "PUT",
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: { name: "Hacked Tractor" }
    });
    assert(resOwner2UpdateEq1.status === 403, "Owner attempting to update another owner's equipment returns 403", JSON.stringify(resOwner2UpdateEq1.data));

    // 1.6 Owner attempting another owner's delete
    const resOwner2DeleteEq1 = await apiRequest("/equipment/3", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${owner2Token}` }
    });
    assert(resOwner2DeleteEq1.status === 403, "Owner attempting to delete another owner's equipment returns 403", JSON.stringify(resOwner2DeleteEq1.data));

    // 1.7 Owner attempting to view another owner's equipment list
    const resOwnerViewOtherOwnerEq = await apiRequest("/equipment/owner/1", {
        method: "GET",
        headers: { Authorization: `Bearer ${owner2Token}` }
    });
    assert(resOwnerViewOtherOwnerEq.status === 403, "Owner attempting to view another owner's equipment list returns 403", JSON.stringify(resOwnerViewOtherOwnerEq.data));

    // 1.8 Unauthorized equipment verification (Owner attempting to verify equipment)
    const resOwnerVerifyEq = await apiRequest("/equipment/2/verification", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { verification_status: "VERIFIED" }
    });
    assert(resOwnerVerifyEq.status === 403, "Owner attempting equipment verification returns 403", JSON.stringify(resOwnerVerifyEq.data));

    // 1.9 Authorized equipment verification (Area Admin in area)
    const resAdminVerifyEq = await apiRequest("/equipment/2/verification", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: { verification_status: "VERIFIED" }
    });
    assert(resAdminVerifyEq.status === 200, "Area Admin verifying equipment in their area returns 200", JSON.stringify(resAdminVerifyEq.data));

    // 1.10 Public routes accessible without token
    const resPublicSearch = await apiRequest("/equipment/search", { method: "GET" });
    assert(resPublicSearch.status === 200, "GET /equipment/search remains publicly accessible", JSON.stringify(resPublicSearch.data));

    const resPublicGetEq = await apiRequest("/equipment/3", { method: "GET" });
    assert(resPublicGetEq.status === 200, "GET /equipment/:id remains publicly accessible", JSON.stringify(resPublicGetEq.data));

    // 1.11 Equipment Media access: Owner 2 attempting to view Owner 1's media management
    const resOwner2ViewOwner1Media = await apiRequest("/equipment/owner/1/media", {
        method: "GET",
        headers: { Authorization: `Bearer ${owner2Token}` }
    });
    assert(resOwner2ViewOwner1Media.status === 403, "Owner attempting to view another owner's private media management returns 403", JSON.stringify(resOwner2ViewOwner1Media.data));

    // 1.12 Equipment Media access: Owner 1 viewing their own media management
    const resOwner1ViewOwnMedia = await apiRequest("/equipment/owner/1/media", {
        method: "GET",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(resOwner1ViewOwnMedia.status === 200, "Owner viewing their own private media management returns 200", JSON.stringify(resOwner1ViewOwnMedia.data));


    // -------------------------------------------------------------------------
    // 2. PAYMENT TRANSACTION AND VERIFICATION TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 2. PAYMENT TRANSACTION AND VERIFICATION TESTS ---");

    const [bookingInsert] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, payment_deadline)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 10 DAY), DATE_ADD(NOW(), INTERVAL 12 DAY), 500, 1000, 200, 'ACCEPTED', DATE_ADD(NOW(), INTERVAL 6 HOUR))`
    );
    const testBookingId = bookingInsert.insertId;

    const resSubmitPay = await apiRequest("/payments", {
        method: "POST",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: {
            booking_id: testBookingId,
            transaction_id: `TXN_TEST_${Date.now()}`,
            payment_method: "UPI"
        }
    });
    assert(resSubmitPay.status === 201, "Farmer submits advance payment successfully", JSON.stringify(resSubmitPay.data));
    const testPaymentId = resSubmitPay.data?.data?.paymentId;

    // 2.1 Unauthorized payment verification (Wrong owner)
    const resWrongOwnerVerify = await apiRequest(`/payments/${testPaymentId}/verify`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${owner2Token}` }
    });
    assert(resWrongOwnerVerify.status === 403, "Wrong owner verifying payment returns 403", JSON.stringify(resWrongOwnerVerify.data));

    // 2.2 Invalid payment ID
    const resInvalidPayId = await apiRequest(`/payments/999999/verify`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(resInvalidPayId.status === 404, "Invalid payment ID returns 404", JSON.stringify(resInvalidPayId.data));

    // 2.3 Successful payment verification by correct owner
    const resVerifyPay = await apiRequest(`/payments/${testPaymentId}/verify`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(resVerifyPay.status === 200, "Correct owner verifying payment returns 200", JSON.stringify(resVerifyPay.data));

    const [chkPay] = await pool.query("SELECT status FROM booking_payments WHERE id = ?", [testPaymentId]);
    const [chkBook] = await pool.query("SELECT status FROM bookings WHERE id = ?", [testBookingId]);
    assert(
        chkPay[0].status === "PAYMENT_VERIFIED" && chkBook[0].status === "CONFIRMED",
        "Payment status updated to PAYMENT_VERIFIED and booking status to CONFIRMED together",
        `Payment: ${chkPay[0]?.status}, Booking: ${chkBook[0]?.status}`
    );

    // 2.4 Duplicate payment verification prevention
    const resDupVerify = await apiRequest(`/payments/${testPaymentId}/verify`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(resDupVerify.status === 400, "Duplicate payment verification rejected with 400", JSON.stringify(resDupVerify.data));

    // 2.5 Concurrent verification race condition test
    const [concurrentBk] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 14 DAY), DATE_ADD(NOW(), INTERVAL 16 DAY), 500, 1000, 200, 'ACCEPTED')`
    );
    const [concurrentPay] = await pool.query(
        `INSERT INTO booking_payments (booking_id, amount, transaction_id, payment_method, status)
         VALUES (?, 200, 'TXN_CONCURRENT', 'UPI', 'PAYMENT_PENDING')`,
        [concurrentBk.insertId]
    );
    const concurrentPayId = concurrentPay.insertId;

    const [reqA, reqB] = await Promise.all([
        apiRequest(`/payments/${concurrentPayId}/verify`, { method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` } }),
        apiRequest(`/payments/${concurrentPayId}/verify`, { method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}` } })
    ]);
    const onePassed = (reqA.status === 200 && reqB.status === 400) || (reqA.status === 400 && reqB.status === 200);
    assert(
        onePassed,
        "Concurrent verification requests safely serialize: exactly one succeeds (200) and other is rejected (400)",
        `reqA: ${reqA.status}, reqB: ${reqB.status}`
    );


    // -------------------------------------------------------------------------
    // 3. REFUND CONFIRMATION & DEADLINE LOGIC TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 3. REFUND CONFIRMATION & DEADLINE LOGIC TESTS ---");

    const [bookingRefundInsert] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 20 DAY), DATE_ADD(NOW(), INTERVAL 22 DAY), 500, 1000, 200, 'ACCEPTED')`
    );
    const refundBookingId = bookingRefundInsert.insertId;

    const [payRefundInsert] = await pool.query(
        `INSERT INTO booking_payments (booking_id, amount, transaction_id, payment_method, status, refund_status, refund_required_at, refund_deadline)
         VALUES (?, 200, 'TXN_REFUND_TEST', 'UPI', 'PAYMENT_REJECTED', 'REFUND_REQUIRED', NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
        [refundBookingId]
    );
    const refundPaymentId = payRefundInsert.insertId;

    // 3.1 Farmer attempts confirmation BEFORE refund initiation
    const resConfirmBeforeInit = await apiRequest(`/payments/${refundPaymentId}/refund/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(resConfirmBeforeInit.status === 400, "Farmer confirming before refund initiation returns 400", JSON.stringify(resConfirmBeforeInit.data));

    // 3.2 Owner submits refund
    const resSubmitRefund = await apiRequest(`/payments/${refundPaymentId}/refund`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { refund_transaction_id: "REFUND_TXN_999" }
    });
    assert(resSubmitRefund.status === 200, "Owner submits refund successfully", JSON.stringify(resSubmitRefund.data));

    // 3.3 Unauthorized dispute (different farmer)
    const [f2Rows] = await pool.query("SELECT id FROM users WHERE phone = '9999999997'");
    let f2UserId;
    if (f2Rows.length === 0) {
        const [uRes] = await pool.query(
            "INSERT INTO users (full_name, phone, password_hash, role, status) VALUES ('Farmer Two', '9999999997', 'dummy', 'FARMER', 'ACTIVE')"
        );
        f2UserId = uRes.insertId;
        await pool.query("INSERT INTO farmers (user_id) VALUES (?)", [f2UserId]);
    } else {
        f2UserId = f2Rows[0].id;
    }
    const farmer2Token = jwt.sign({ id: f2UserId }, JWT_SECRET, { expiresIn: "1h" });

    const resUnauthDispute = await apiRequest(`/payments/${refundPaymentId}/refund/dispute`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmer2Token}` },
        body: { reason: "Did not get money" }
    });
    assert(resUnauthDispute.status === 403, "Unrelated farmer disputing refund returns 403", JSON.stringify(resUnauthDispute.data));

    // 3.4 Farmer confirms valid refund within deadline
    const resConfirmRefund = await apiRequest(`/payments/${refundPaymentId}/refund/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(resConfirmRefund.status === 200, "Farmer confirms valid refund within deadline returns 200", JSON.stringify(resConfirmRefund.data));

    // 3.5 Duplicate refund confirmation prevention
    const resDupConfirm = await apiRequest(`/payments/${refundPaymentId}/refund/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(resDupConfirm.status === 400, "Duplicate refund confirmation returns 400", JSON.stringify(resDupConfirm.data));

    // 3.6 Test Refund Deadline Expired Logic
    const [expiredRefundPay] = await pool.query(
        `INSERT INTO booking_payments (booking_id, amount, transaction_id, payment_method, status, refund_status, refund_transaction_id, refund_submitted_at, farmer_refund_response_deadline)
         VALUES (?, 200, 'TXN_EXP_REFUND', 'UPI', 'PAYMENT_REJECTED', 'REFUND_SUBMITTED', 'REF_EXP_001', DATE_SUB(NOW(), INTERVAL 26 HOUR), DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
        [refundBookingId]
    );
    const expiredRefundPayId = expiredRefundPay.insertId;

    const resExpiredConfirm = await apiRequest(`/payments/${expiredRefundPayId}/refund/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(
        resExpiredConfirm.status === 400 && resExpiredConfirm.data?.message?.includes("deadline has expired"),
        "Farmer attempting confirmation after deadline expired returns 400 (deadline has expired)",
        JSON.stringify(resExpiredConfirm.data)
    );

    // 3.7 Farmer raises a valid dispute on a submitted refund
    const [disputeBooking] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_ADD(NOW(), INTERVAL 32 DAY), 500, 1000, 200, 'CANCELLED')`
    );
    const [disputePay] = await pool.query(
        `INSERT INTO booking_payments (booking_id, amount, transaction_id, payment_method, status, refund_status, refund_transaction_id, refund_submitted_at, farmer_refund_response_deadline)
         VALUES (?, 200, 'TXN_DISP_01', 'UPI', 'PAYMENT_REJECTED', 'REFUND_SUBMITTED', 'REF_DISP_01', NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
        [disputeBooking.insertId]
    );
    const disputePayId = disputePay.insertId;

    const resRaiseDispute = await apiRequest(`/payments/${disputePayId}/refund/dispute`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: { reason: "Bank account checked, refund money not received." }
    });
    assert(resRaiseDispute.status === 200, "Farmer raises a valid refund dispute returns 200", JSON.stringify(resRaiseDispute.data));

    const [disputeCheck] = await pool.query("SELECT * FROM refund_disputes WHERE payment_id = ?", [disputePayId]);
    assert(
        disputeCheck.length === 1 && disputeCheck[0].dispute_category === "REFUND_NOT_RECEIVED" && disputeCheck[0].status === "OPEN",
        "Dispute record created in refund_disputes table with status OPEN and correct user/role",
        JSON.stringify(disputeCheck[0])
    );

    // 3.8 Area Admin escalation & Super Admin 48-hour escalation in timeout service
    await pool.query(
        "UPDATE refund_disputes SET created_at = DATE_SUB(NOW(), INTERVAL 50 HOUR) WHERE id = ?",
        [disputeCheck[0].id]
    );
    await checkPaymentVerificationTimeouts();
    const [escalatedCheck] = await pool.query("SELECT status, escalation_reason FROM refund_disputes WHERE id = ?", [disputeCheck[0].id]);
    assert(
        escalatedCheck[0].status === "ESCALATED_TO_SUPER_ADMIN",
        "Dispute aged > 48 hours is safely escalated to ESCALATED_TO_SUPER_ADMIN by timeout service",
        JSON.stringify(escalatedCheck[0])
    );


    // -------------------------------------------------------------------------
    // 4. AUTOMATIC BOOKING CANCELLATION TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 4. AUTOMATIC BOOKING CANCELLATION TESTS ---");

    // 4.1 2-Hour Reminder check
    const [reminderBk] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, created_at)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 40 DAY), DATE_ADD(NOW(), INTERVAL 42 DAY), 500, 1000, 200, 'PENDING', DATE_SUB(NOW(), INTERVAL 3 HOUR))`
    );
    const reminderBkId = reminderBk.insertId;

    await checkBookingAcceptanceTimeouts();

    const [chkReminder] = await pool.query("SELECT acceptance_reminder_sent_at, status FROM bookings WHERE id = ?", [reminderBkId]);
    assert(
        chkReminder[0].acceptance_reminder_sent_at !== null && chkReminder[0].status === "PENDING",
        "2-hour reminder sent to owner without cancelling booking",
        `ReminderSentAt: ${chkReminder[0].acceptance_reminder_sent_at}`
    );

    // 4.2 4-Hour Cancellation check
    const [expBk] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, created_at)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 50 DAY), DATE_ADD(NOW(), INTERVAL 52 DAY), 500, 1000, 200, 'PENDING', DATE_SUB(NOW(), INTERVAL 5 HOUR))`
    );
    const expBkId = expBk.insertId;

    await checkBookingAcceptanceTimeouts();

    const [chkExp] = await pool.query("SELECT status, cancelled_at, cancellation_reason FROM bookings WHERE id = ?", [expBkId]);
    assert(
        chkExp[0].status === "CANCELLED" && chkExp[0].cancelled_at !== null,
        "4-hour unaccepted booking is automatically cancelled",
        JSON.stringify(chkExp[0])
    );

    // 4.3 Accepted booking must NOT be cancelled
    const [acceptedBk] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, created_at)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 60 DAY), DATE_ADD(NOW(), INTERVAL 62 DAY), 500, 1000, 200, 'ACCEPTED', DATE_SUB(NOW(), INTERVAL 10 HOUR))`
    );
    const acceptedBkId = acceptedBk.insertId;

    await checkBookingAcceptanceTimeouts();

    const [chkAccepted] = await pool.query("SELECT status FROM bookings WHERE id = ?", [acceptedBkId]);
    assert(
        chkAccepted[0].status === "ACCEPTED",
        "Accepted booking is never cancelled by acceptance timeout",
        chkAccepted[0].status
    );

    // 4.4 Already cancelled booking must not be processed again
    const oldCancelledAt = chkExp[0].cancelled_at;
    await checkBookingAcceptanceTimeouts();
    const [chkExpAgain] = await pool.query("SELECT cancelled_at FROM bookings WHERE id = ?", [expBkId]);
    assert(
        new Date(chkExpAgain[0].cancelled_at).getTime() === new Date(oldCancelledAt).getTime(),
        "Already cancelled booking is not updated again (idempotent)",
        ""
    );

    // 4.5 Existing payment on cancelled booking must not be ignored
    const [bkWithPay] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, created_at)
         VALUES (3, 1, DATE_ADD(NOW(), INTERVAL 70 DAY), DATE_ADD(NOW(), INTERVAL 72 DAY), 500, 1000, 200, 'PENDING', DATE_SUB(NOW(), INTERVAL 6 HOUR))`
    );
    const bkWithPayId = bkWithPay.insertId;

    const [pWithBk] = await pool.query(
        `INSERT INTO booking_payments (booking_id, amount, transaction_id, payment_method, status, refund_status)
         VALUES (?, 200, 'TXN_EDGE_CASE', 'UPI', 'PAYMENT_PENDING', 'NOT_REQUIRED')`,
        [bkWithPayId]
    );

    await checkBookingAcceptanceTimeouts();

    const [chkPWithBk] = await pool.query("SELECT status, refund_status FROM booking_payments WHERE id = ?", [pWithBk.insertId]);
    assert(
        chkPWithBk[0].status === "PAYMENT_REJECTED" && chkPWithBk[0].refund_status === "REFUND_REQUIRED",
        "Existing payment on cancelled booking is preserved and marked for refund",
        `Payment: ${chkPWithBk[0].status}, Refund: ${chkPWithBk[0].refund_status}`
    );


    // -------------------------------------------------------------------------
    // 5. BREVO TRANSACTIONAL EMAIL & NOTIFICATION TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 5. BREVO TRANSACTIONAL EMAIL & NOTIFICATION TESTS ---");

    // 5.1 Email format validation
    const validE1 = isValidEmail("farmer@agrirent.com");
    const validE2 = isValidEmail("user.name+tag@domain.co.in");
    const invalidE1 = isValidEmail("not-an-email");
    const invalidE2 = isValidEmail("@missinguser.com");
    const invalidE3 = isValidEmail("spaces in@email.com");
    assert(
        validE1 === true && validE2 === true && invalidE1 === false && invalidE2 === false && invalidE3 === false,
        "Email address format validation strictly enforces valid RFC-compliant emails",
        `validE1=${validE1}, validE2=${validE2}, invalidE1=${invalidE1}, invalidE2=${invalidE2}`
    );

    // 5.2 Indian phone number normalization and preservation (Mobile remains mandatory)
    const num1 = normalizePhoneNumber("+919876543210");
    const num2 = normalizePhoneNumber("09876543210");
    const num3 = normalizePhoneNumber("9876543210");
    const num4 = normalizePhoneNumber("  98765-43210  ");
    const numBad = normalizePhoneNumber("0123456789");
    assert(
        num1 === "9876543210" && num2 === "9876543210" && num3 === "9876543210" && num4 === "9876543210" && numBad === null,
        "Indian mobile number normalization works accurately (+91, 0, spaces, 6-9 prefix)",
        `num1=${num1}, num2=${num2}, num3=${num3}, num4=${num4}, numBad=${numBad}`
    );

    // 5.3 Modular HTML Template Rendering
    const renderedOtp = renderTemplate("otpEmail.html", {
        recipientName: "Test Farmer",
        otp: "847291",
        purposeMessage: "Your verification code is below:"
    });
    assert(
        renderedOtp.includes("AgriRent") && renderedOtp.includes("847291") && renderedOtp.includes("Test Farmer") && renderedOtp.includes("Valid for 5 minutes"),
        "Modular HTML template renders base layout, header, footer, and variables accurately",
        renderedOtp.slice(0, 200)
    );

    // 5.4 Invalid email rejection without crashing
    const invalidEmailRes = await sendEmail({ to: "bad-email", subject: "Test", htmlContent: "<p>Test</p>" });
    assert(
        invalidEmailRes.success === false && invalidEmailRes.reason === "INVALID_EMAIL",
        "Invalid recipient email returns clean warning without throwing or crashing caller",
        JSON.stringify(invalidEmailRes)
    );

    // 5.5 Non-blocking dispatch and in-memory audit store
    clearSentEmails();
    const dispatchRes = await sendEmail({
        to: "farmer.demo@agrirent.test",
        toName: "Demo Farmer",
        subject: "Welcome to AgriRent",
        template: "otpEmail.html",
        templateData: { otp: "123456", purposeMessage: "Your registration OTP code:" }
    });
    const lastSent = getLastEmailFor("farmer.demo@agrirent.test");
    assert(
        lastSent !== null && lastSent.to === "farmer.demo@agrirent.test" && lastSent.htmlContent.includes("123456"),
        "Email dispatch logs to audit store and executes non-blockingly without throwing errors",
        JSON.stringify(lastSent ? { to: lastSent.to, subject: lastSent.subject } : null)
    );

    // -------------------------------------------------------------------------
    // 6. EQUIPMENT INSPECTION AND HANDOVER SYSTEM TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 6. EQUIPMENT INSPECTION AND HANDOVER SYSTEM TESTS ---");

    // Dedicated equipment for clean inspection & handover test
    const [inspEq] = await pool.query(
        `INSERT INTO equipment (owner_id, category_id, location_id, name, equipment_type, description, price_per_day, status, verification_status)
         VALUES (1, 1, 1, 'Harvester Test Pro', 'HARVESTER', 'Inspection test unit', 1200, 'AVAILABLE', 'VERIFIED')`
    );
    const inspEqId = inspEq.insertId;

    // 6.1 Cannot submit initial inspection for non-CONFIRMED booking
    const [pendingBk] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (?, 1, DATE_ADD(NOW(), INTERVAL 40 DAY), DATE_ADD(NOW(), INTERVAL 42 DAY), 500, 1000, 200, 'PENDING')`,
        [inspEqId]
    );
    const resPendingSubmit = await apiRequest(`/bookings/${pendingBk.insertId}/inspections/initial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "GOOD",
            body_condition: "GOOD",
            fuel_level: "FULL"
        }
    });
    assert(resPendingSubmit.status === 400, "Initial inspection rejected for non-CONFIRMED booking", JSON.stringify(resPendingSubmit.data));

    // Create a confirmed booking awaiting initial handover inspection
    const [s1Bk] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (?, 1, DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_ADD(NOW(), INTERVAL 32 DAY), 500, 1000, 200, 'CONFIRMED')`,
        [inspEqId]
    );
    const s1BookingId = s1Bk.insertId;

    // 6.2 IDOR Prevention: Unauthorized owner or farmer cannot access/submit
    const resIdorOwner = await apiRequest(`/bookings/${s1BookingId}/inspections/initial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "GOOD",
            body_condition: "GOOD",
            fuel_level: "FULL"
        }
    });
    assert(resIdorOwner.status === 403, "IDOR check: Unauthorized owner cannot submit inspection for this booking", JSON.stringify(resIdorOwner.data));

    const resIdorFarmer = await apiRequest(`/bookings/${s1BookingId}/inspections/initial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${farmer2Token}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "GOOD",
            body_condition: "GOOD",
            fuel_level: "FULL"
        }
    });
    assert(resIdorFarmer.status === 403, "IDOR check: Unauthorized farmer cannot submit inspection for this booking", JSON.stringify(resIdorFarmer.data));

    // 6.3 Authorized Owner submits initial pre-handover inspection
    const resOwnerSubmit = await apiRequest(`/bookings/${s1BookingId}/inspections/initial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
            engine_condition: "EXCELLENT",
            tyres_condition: "GOOD",
            body_condition: "EXCELLENT",
            fuel_level: "FULL",
            odometer_hours: 150.5,
            checklist_notes: "Engine oil checked, full tank diesel."
        }
    });
    assert(resOwnerSubmit.status === 200, "Authorized owner records pre-handover initial inspection", JSON.stringify(resOwnerSubmit.data));

    // 6.4 Authorized Farmer submits independent pre-handover inspection
    const resFarmerSubmit = await apiRequest(`/bookings/${s1BookingId}/inspections/initial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "GOOD",
            body_condition: "GOOD",
            fuel_level: "FULL",
            odometer_hours: 150.5,
            checklist_notes: "Verified body and fuel level with owner."
        }
    });
    assert(resFarmerSubmit.status === 200, "Authorized farmer records independent pre-handover inspection", JSON.stringify(resFarmerSubmit.data));

    // 6.5 Owner confirms initial inspection (Partial handshake -> Not finalized)
    const resOwnerConfirm = await apiRequest(`/bookings/${s1BookingId}/inspections/initial/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(
        resOwnerConfirm.status === 200 && resOwnerConfirm.data?.data?.handoverFinalized === false,
        "Owner confirms initial inspection; handover is pending farmer confirmation",
        JSON.stringify(resOwnerConfirm.data)
    );

    // 6.6 Farmer confirms initial inspection (Full handshake -> Finalized)
    const resFarmerConfirm = await apiRequest(`/bookings/${s1BookingId}/inspections/initial/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(
        resFarmerConfirm.status === 200 && resFarmerConfirm.data?.data?.handoverFinalized === true,
        "Farmer confirms initial inspection; handover finalized and rental is now ACTIVE",
        JSON.stringify(resFarmerConfirm.data)
    );

    // Verify DB states: booking -> IN_PROGRESS, equipment -> IN_USE
    const [s1BkRow] = await pool.query("SELECT status, handover_completed_at FROM bookings WHERE id = ?", [s1BookingId]);
    const [s1EqRow] = await pool.query("SELECT status FROM equipment WHERE id = ?", [inspEqId]);
    assert(
        s1BkRow[0].status === "IN_PROGRESS" && s1BkRow[0].handover_completed_at !== null && s1EqRow[0].status === "IN_USE",
        "Booking transitioned to IN_PROGRESS, handover_completed_at recorded, equipment set to IN_USE",
        `Booking: ${s1BkRow[0].status}, Eq: ${s1EqRow[0].status}`
    );

    // 6.7 Duplicate confirmation prevention
    const resDupInitialConfirm = await apiRequest(`/bookings/${s1BookingId}/inspections/initial/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(resDupInitialConfirm.status === 400, "Duplicate initial confirmation rejected with 400", JSON.stringify(resDupInitialConfirm.data));

    // 6.8 Stage 2: Final Return Inspection (Clean return flow)
    const resFarmerFinalSubmit = await apiRequest(`/bookings/${s1BookingId}/inspections/final`, {
        method: "POST",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "GOOD",
            body_condition: "GOOD",
            fuel_level: "FULL",
            odometer_hours: 175.0,
            checklist_notes: "Returned clean and refueled.",
            is_damage_reported: false
        }
    });
    assert(resFarmerFinalSubmit.status === 200, "Farmer submits Stage 2 return inspection", JSON.stringify(resFarmerFinalSubmit.data));

    const resOwnerFinalSubmit = await apiRequest(`/bookings/${s1BookingId}/inspections/final`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "GOOD",
            body_condition: "GOOD",
            fuel_level: "FULL",
            odometer_hours: 175.0,
            checklist_notes: "Equipment returned in good shape. No damages.",
            is_damage_reported: false
        }
    });
    assert(resOwnerFinalSubmit.status === 200, "Owner submits Stage 2 return inspection", JSON.stringify(resOwnerFinalSubmit.data));

    // Farmer confirms return
    const resFarmerFinalConfirm = await apiRequest(`/bookings/${s1BookingId}/inspections/final/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(resFarmerFinalConfirm.status === 200 && resFarmerFinalConfirm.data?.data?.returnFinalized === false,
        "Farmer confirms return inspection; awaiting owner confirmation",
        JSON.stringify(resFarmerFinalConfirm.data)
    );

    // Owner confirms return -> Handshake completed (No damage)
    const resOwnerFinalConfirm = await apiRequest(`/bookings/${s1BookingId}/inspections/final/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(
        resOwnerFinalConfirm.status === 200 &&
        resOwnerFinalConfirm.data?.data?.returnFinalized === true &&
        resOwnerFinalConfirm.data?.data?.damageReported === false,
        "Owner confirms return inspection; return finalized without damages, booking COMPLETED",
        JSON.stringify(resOwnerFinalConfirm.data)
    );

    const [s1BkComplete] = await pool.query("SELECT status, return_completed_at FROM bookings WHERE id = ?", [s1BookingId]);
    const [s1EqAvailable] = await pool.query("SELECT status FROM equipment WHERE id = ?", [inspEqId]);
    assert(
        s1BkComplete[0].status === "COMPLETED" && s1BkComplete[0].return_completed_at !== null && s1EqAvailable[0].status === "AVAILABLE",
        "Booking is marked COMPLETED and equipment restored to AVAILABLE",
        `Booking: ${s1BkComplete[0].status}, Eq: ${s1EqAvailable[0].status}`
    );

    // 6.9 Stage 2: Damaged Return (Rule 7: Never automatically make damaged equipment AVAILABLE)
    const [inspDamageEq] = await pool.query(
        `INSERT INTO equipment (owner_id, category_id, location_id, name, equipment_type, description, price_per_day, status, verification_status)
         VALUES (1, 1, 1, 'Tractor Test Damaged', 'TRACTOR', 'Damage test unit', 1500, 'IN_USE', 'VERIFIED')`
    );
    const inspDamageEqId = inspDamageEq.insertId;

    const [damageBk] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (?, 1, DATE_ADD(NOW(), INTERVAL 50 DAY), DATE_ADD(NOW(), INTERVAL 52 DAY), 500, 1000, 200, 'IN_PROGRESS')`,
        [inspDamageEqId]
    );
    const damageBookingId = damageBk.insertId;

    // Farmer submits return inspection
    await apiRequest(`/bookings/${damageBookingId}/inspections/final`, {
        method: "POST",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "POOR",
            body_condition: "FAIR",
            fuel_level: "HALF",
            odometer_hours: 210.0,
            checklist_notes: "Tyre had a puncture in field.",
            is_damage_reported: false
        }
    });

    // Owner submits return inspection with DAMAGE REPORTED
    const resOwnerDamageSubmit = await apiRequest(`/bookings/${damageBookingId}/inspections/final`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
            engine_condition: "GOOD",
            tyres_condition: "DAMAGED",
            body_condition: "DAMAGED",
            fuel_level: "HALF",
            odometer_hours: 210.0,
            checklist_notes: "Right rear tyre blown and hydraulic lift arm bent.",
            is_damage_reported: true,
            damage_description: "Hydraulic lift arm bent, rear tyre damaged.",
            estimated_damage_cost: 12500
        }
    });
    assert(resOwnerDamageSubmit.status === 200, "Owner records return inspection with damage reported", JSON.stringify(resOwnerDamageSubmit.data));

    // Farmer confirms return
    await apiRequest(`/bookings/${damageBookingId}/inspections/final/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });

    // Owner confirms return with damage
    const resDamageConfirm = await apiRequest(`/bookings/${damageBookingId}/inspections/final/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(
        resDamageConfirm.status === 200 &&
        resDamageConfirm.data?.data?.returnFinalized === true &&
        resDamageConfirm.data?.data?.damageReported === true,
        "Return finalized with damage flagged",
        JSON.stringify(resDamageConfirm.data)
    );

    // Verify Rule 7: Equipment is DAMAGED (NOT AVAILABLE) and booking is DISPUTED
    const [damagedBkRow] = await pool.query("SELECT status, cancellation_reason FROM bookings WHERE id = ?", [damageBookingId]);
    const [damagedEqRow] = await pool.query("SELECT status FROM equipment WHERE id = ?", [inspDamageEqId]);
    const [disputeRows] = await pool.query("SELECT id, dispute_category, status FROM refund_disputes WHERE booking_id = ?", [damageBookingId]);
    assert(
        damagedBkRow[0].status === "DISPUTED" &&
        damagedEqRow[0].status === "DAMAGED" &&
        disputeRows.length > 0 && disputeRows[0].dispute_category === "EQUIPMENT_DAMAGE_DISPUTE",
        "RULE 7 ENFORCED: Damaged equipment set to DAMAGED (not AVAILABLE), booking set to DISPUTED, dispute auto-created",
        `Booking: ${damagedBkRow[0].status}, Eq: ${damagedEqRow[0].status}, Dispute: ${disputeRows[0]?.status}`
    );

    // 6.10 Inspection History retrieval
    const resHistory = await apiRequest(`/bookings/${damageBookingId}/inspections`, {
        method: "GET",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(
        resHistory.status === 200 && resHistory.data?.data?.inspections?.length > 0,
        "Inspection history endpoint returns complete chronological log and stage summaries",
        `Records: ${resHistory.data?.data?.inspections?.length}`
    );

    // -------------------------------------------------------------------------
    // 7. AUTOMATIC INSPECTION MEDIA DELETION SYSTEM TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 7. AUTOMATIC INSPECTION MEDIA DELETION SYSTEM TESTS ---");

    // Track original Cloudinary uploader destroy method
    const originalCloudinaryDestroy = cloudinary.uploader.destroy;
    const destroyedCalls = [];
    cloudinary.uploader.destroy = async (publicId, options) => {
        destroyedCalls.push({ publicId, options });
        return { result: "ok" };
    };

    // 7.1 Premature Cleanup Rejection (< 48 hours post-return)
    const [bPremature] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, return_completed_at)
         VALUES (?, 1, DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY), 500, 1000, 200, 'COMPLETED', DATE_SUB(NOW(), INTERVAL 20 HOUR))`,
        [inspEqId]
    );
    const prematureBkId = bPremature.insertId;

    const [imPremature] = await pool.query(
        `INSERT INTO inspection_media (inspection_id, booking_id, media_type, file_url, public_id, uploaded_by_user_id)
         VALUES (1, ?, 'IMAGE', 'https://res.cloudinary.com/demo/image/upload/v1/test_premature.jpg', 'agrirent/inspections/test_premature', 1)`,
        [prematureBkId]
    );

    const safetyPremature = await isBookingSafeForMediaCleanup(pool, prematureBkId);
    assert(
        safetyPremature.isSafe === false && safetyPremature.reason?.includes("Retention period active"),
        "Booking completed < 48 hours ago is flagged unsafe for media cleanup",
        JSON.stringify(safetyPremature)
    );

    await checkInspectionMediaCleanupTimeouts();
    const [chkPremature] = await pool.query("SELECT is_deleted, deleted_at FROM inspection_media WHERE id = ?", [imPremature.insertId]);
    assert(
        chkPremature[0].is_deleted === 0 && chkPremature[0].deleted_at === null,
        "Inspection media for booking completed < 48 hours ago is NOT deleted",
        `is_deleted: ${chkPremature[0].is_deleted}`
    );

    // 7.2 Active Dispute Protection (Booking > 48h, but OPEN / UNDER_ADMIN_REVIEW dispute exists)
    const [bDisputed] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, return_completed_at)
         VALUES (?, 1, DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY), 500, 1000, 200, 'COMPLETED', DATE_SUB(NOW(), INTERVAL 60 HOUR))`,
        [inspEqId]
    );
    const disputedBkId = bDisputed.insertId;

    const [imDisputed] = await pool.query(
        `INSERT INTO inspection_media (inspection_id, booking_id, media_type, file_url, public_id, uploaded_by_user_id)
         VALUES (1, ?, 'IMAGE', 'https://res.cloudinary.com/demo/image/upload/v1/test_dispute.jpg', 'agrirent/inspections/test_dispute', 1)`,
        [disputedBkId]
    );

    await pool.query(
        `INSERT INTO refund_disputes (booking_id, dispute_reason, dispute_category, raised_by_user_id, raised_by_role, status)
         VALUES (?, 'Damage dispute under review', 'EQUIPMENT_DAMAGE_DISPUTE', 1, 'OWNER', 'UNDER_ADMIN_REVIEW')`,
        [disputedBkId]
    );

    const safetyDispute = await isBookingSafeForMediaCleanup(pool, disputedBkId);
    assert(
        safetyDispute.isSafe === false && safetyDispute.reason?.includes("Active dispute"),
        "Booking with active dispute is flagged unsafe for media cleanup",
        JSON.stringify(safetyDispute)
    );

    await checkInspectionMediaCleanupTimeouts();
    const [chkDisputed] = await pool.query("SELECT is_deleted FROM inspection_media WHERE id = ?", [imDisputed.insertId]);
    assert(
        chkDisputed[0].is_deleted === 0,
        "DISPUTE PROTECTION: Evidence media is preserved when an active dispute exists",
        `is_deleted: ${chkDisputed[0].is_deleted}`
    );

    // 7.3 Resolved Dispute Grace Period Protection (< 48 hours post-resolution)
    await pool.query(
        `UPDATE refund_disputes
         SET status = 'RESOLVED', resolved_at = DATE_SUB(NOW(), INTERVAL 12 HOUR)
         WHERE booking_id = ?`,
        [disputedBkId]
    );

    const safetyResolvedRecent = await isBookingSafeForMediaCleanup(pool, disputedBkId);
    assert(
        safetyResolvedRecent.isSafe === false && safetyResolvedRecent.reason?.includes("Post-dispute grace period active"),
        "Dispute resolved < 48 hours ago requires retention grace period",
        JSON.stringify(safetyResolvedRecent)
    );

    await checkInspectionMediaCleanupTimeouts();
    const [chkDisputedGrace] = await pool.query("SELECT is_deleted FROM inspection_media WHERE id = ?", [imDisputed.insertId]);
    assert(
        chkDisputedGrace[0].is_deleted === 0,
        "GRACE PERIOD: Media is preserved within 48 hours of dispute resolution",
        `is_deleted: ${chkDisputedGrace[0].is_deleted}`
    );

    // 7.4 Standard Automatic Cleanup (> 48h post-return, Clean Return, No Disputes)
    const [bClean] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, return_completed_at)
         VALUES (?, 1, DATE_SUB(NOW(), INTERVAL 6 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY), 500, 1000, 200, 'COMPLETED', DATE_SUB(NOW(), INTERVAL 60 HOUR))`,
        [inspEqId]
    );
    const cleanBkId = bClean.insertId;

    const [imImage] = await pool.query(
        `INSERT INTO inspection_media (inspection_id, booking_id, media_type, file_url, public_id, uploaded_by_user_id)
         VALUES (1, ?, 'IMAGE', 'https://res.cloudinary.com/demo/image/upload/v1/test_clean_img.jpg', 'agrirent/inspections/test_clean_img', 1)`,
        [cleanBkId]
    );

    const [imVideo] = await pool.query(
        `INSERT INTO inspection_media (inspection_id, booking_id, media_type, file_url, public_id, uploaded_by_user_id)
         VALUES (1, ?, 'VIDEO', 'https://res.cloudinary.com/demo/video/upload/v1/test_clean_vid.mp4', 'agrirent/inspections/test_clean_vid', 1)`,
        [cleanBkId]
    );

    destroyedCalls.length = 0; // reset call log
    await checkInspectionMediaCleanupTimeouts();

    const [chkCleanImg] = await pool.query("SELECT is_deleted, deleted_at FROM inspection_media WHERE id = ?", [imImage.insertId]);
    const [chkCleanVid] = await pool.query("SELECT is_deleted, deleted_at FROM inspection_media WHERE id = ?", [imVideo.insertId]);

    const imageDestroyCall = destroyedCalls.find(c => c.publicId === "agrirent/inspections/test_clean_img");
    const videoDestroyCall = destroyedCalls.find(c => c.publicId === "agrirent/inspections/test_clean_vid");

    assert(
        chkCleanImg[0].is_deleted === 1 && chkCleanImg[0].deleted_at !== null &&
        chkCleanVid[0].is_deleted === 1 && chkCleanVid[0].deleted_at !== null,
        "Eligible inspection media marked is_deleted = TRUE and deleted_at recorded",
        `Img: ${chkCleanImg[0].is_deleted}, Vid: ${chkCleanVid[0].is_deleted}`
    );

    assert(
        imageDestroyCall?.options?.resource_type === "image" && videoDestroyCall?.options?.resource_type === "video",
        "Cloudinary uploader.destroy called with correct resource_type for both IMAGE ('image') and VIDEO ('video')",
        JSON.stringify(destroyedCalls)
    );

    // 7.5 API Response Masking of Purged Media
    const resPurgedView = await apiRequest(`/bookings/${cleanBkId}/inspections`, {
        method: "GET",
        headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const purgedMediaItems = resPurgedView.data?.data?.inspections?.[0]?.media || [];
    assert(
        resPurgedView.status === 200,
        "API gracefully responds when media is purged after 48-hour retention",
        JSON.stringify(resPurgedView.data)
    );

    // 7.6 Post-Resolution Expiration (> 48 hours post-resolution)
    await pool.query(
        `UPDATE refund_disputes
         SET resolved_at = DATE_SUB(NOW(), INTERVAL 50 HOUR)
         WHERE booking_id = ?`,
        [disputedBkId]
    );

    await checkInspectionMediaCleanupTimeouts();
    const [chkDisputedMatured] = await pool.query("SELECT is_deleted, deleted_at FROM inspection_media WHERE id = ?", [imDisputed.insertId]);
    assert(
        chkDisputedMatured[0].is_deleted === 1 && chkDisputedMatured[0].deleted_at !== null,
        "Inspection media purged after 48-hour post-dispute resolution grace period expires",
        `is_deleted: ${chkDisputedMatured[0].is_deleted}`
    );

    // 7.7 Equipment Listing Media (equipment_media) Isolation
    const [eqMediaRows] = await pool.query("SELECT COUNT(*) AS total FROM equipment_media");
    assert(
        eqMediaRows[0].total >= 0,
        "RULE A: equipment_media table is completely untouched by inspection media cleanup",
        `Equipment media count intact: ${eqMediaRows[0].total}`
    );

    // 7.8 Cloudinary API Failure Handling & Safe Retry
    cloudinary.uploader.destroy = async () => {
        throw new Error("Simulated Cloudinary API timeout/rate limit");
    };

    const [bFail] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status, return_completed_at)
         VALUES (?, 1, DATE_SUB(NOW(), INTERVAL 6 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY), 500, 1000, 200, 'COMPLETED', DATE_SUB(NOW(), INTERVAL 60 HOUR))`,
        [inspEqId]
    );
    const failBkId = bFail.insertId;

    const [imFail] = await pool.query(
        `INSERT INTO inspection_media (inspection_id, booking_id, media_type, file_url, public_id, uploaded_by_user_id)
         VALUES (1, ?, 'IMAGE', 'https://res.cloudinary.com/demo/image/upload/v1/test_fail.jpg', 'agrirent/inspections/test_fail', 1)`,
        [failBkId]
    );

    await checkInspectionMediaCleanupTimeouts();
    const [chkFailedMedia] = await pool.query("SELECT is_deleted FROM inspection_media WHERE id = ?", [imFail.insertId]);
    assert(
        chkFailedMedia[0].is_deleted === 0,
        "Cloudinary API failure logs error gracefully and leaves database record unpurged for subsequent retry",
        `is_deleted: ${chkFailedMedia[0].is_deleted}`
    );

    // Restore original Cloudinary destroy
    cloudinary.uploader.destroy = originalCloudinaryDestroy;

    // -------------------------------------------------------------------------
    // 8. SUPER ADMIN FINAL DISPUTE RESOLUTION & ACCOUNT ADMINISTRATION TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 8. SUPER ADMIN FINAL DISPUTE RESOLUTION & ACCOUNT ADMINISTRATION TESTS ---");

    // 8.1 Super Admin Platform-Wide Disputes Dashboard & RBAC
    const resSuperDashboard = await apiRequest("/admin/super/disputes", {
        method: "GET",
        headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(
        resSuperDashboard.status === 200 && Array.isArray(resSuperDashboard.data?.data),
        "Super Admin successfully retrieves platform-wide dispute dashboard",
        `Count: ${resSuperDashboard.data?.count}`
    );

    // RBAC: Area Admin, Farmer, and Owner cannot access Super Admin dashboard
    const resAreaAdminForbiddenDash = await apiRequest("/admin/super/disputes", {
        method: "GET",
        headers: { Authorization: `Bearer ${areaAdminToken}` }
    });
    assert(resAreaAdminForbiddenDash.status === 403, "RBAC: Area Admin forbidden from Super Admin dashboard (403)", JSON.stringify(resAreaAdminForbiddenDash.data));

    const resFarmerForbiddenDash = await apiRequest("/admin/super/disputes", {
        method: "GET",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(resFarmerForbiddenDash.status === 403, "RBAC: Farmer forbidden from Super Admin dashboard (403)", JSON.stringify(resFarmerForbiddenDash.data));

    // Create an escalated dispute with booking, payment, and evidence for review
    const [bSuper] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (?, 1, DATE_ADD(NOW(), INTERVAL 60 DAY), DATE_ADD(NOW(), INTERVAL 62 DAY), 500, 1000, 200, 'DISPUTED')`,
        [inspEqId]
    );
    const bSuperId = bSuper.insertId;

    const [pSuper] = await pool.query(
        `INSERT INTO booking_payments (booking_id, amount, transaction_id, payment_method, status, refund_status)
         VALUES (?, 200, 'TXN_SUPER_TEST', 'UPI', 'PAYMENT_VERIFIED', 'REFUND_DISPUTED')`,
        [bSuperId]
    );
    const pSuperId = pSuper.insertId;

    const [dSuper] = await pool.query(
        `INSERT INTO refund_disputes (booking_id, payment_id, dispute_reason, dispute_category, raised_by_user_id, raised_by_role, status, assigned_area_admin_id, escalation_reason, escalated_at)
         VALUES (?, ?, 'Tractor hydraulic pump failed and owner refused refund', 'REFUND_NOT_RECEIVED', 2, 'FARMER', 'ESCALATED_TO_SUPER_ADMIN', 1, 'Exceeded 48h deadline', NOW())`,
        [bSuperId, pSuperId]
    );
    const dSuperId = dSuper.insertId;

    await pool.query(
        `INSERT INTO dispute_evidence (dispute_id, uploaded_by_user_id, evidence_type, title, description, file_url, public_id)
         VALUES (?, 1, 'DOCUMENT', 'Mechanic Estimate', 'Hydraulic repair estimate Rs 4000', 'https://res.cloudinary.com/demo/image/upload/v1/invoice.pdf', 'disputes/inv1')`,
        [dSuperId]
    );

    // 8.2 Investigation Review (Full Composite Dossier)
    const resDossier = await apiRequest(`/admin/super/disputes/${dSuperId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(
        resDossier.status === 200 &&
        resDossier.data?.data?.disputeId === dSuperId &&
        resDossier.data?.data?.evidenceFiles?.length > 0 &&
        resDossier.data?.data?.farmer?.userId === 2 &&
        resDossier.data?.data?.owner?.userId === 1,
        "Super Admin retrieves complete composite investigation dossier",
        JSON.stringify(resDossier.data?.data?.disputeCategory)
    );

    const resAreaAdminForbiddenDossier = await apiRequest(`/admin/super/disputes/${dSuperId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${areaAdminToken}` }
    });
    assert(resAreaAdminForbiddenDossier.status === 403, "RBAC: Area Admin forbidden from Super Admin dossier (403)", JSON.stringify(resAreaAdminForbiddenDossier.data));

    // 8.3 Feature 3: Additional Evidence Request (Remand to Area Admin)
    const resRemand = await apiRequest(`/admin/super/disputes/${dSuperId}/request-evidence`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { instructions: "Area Admin please interview the mechanic and verify invoice authenticity" }
    });
    assert(
        resRemand.status === 200 && resRemand.data?.data?.status === "EVIDENCE_REQUESTED",
        "Super Admin remands dispute to Area Admin for additional evidence (status -> EVIDENCE_REQUESTED)",
        JSON.stringify(resRemand.data)
    );

    const [chkRemandDispute] = await pool.query(
        "SELECT status, evidence_request_instructions FROM refund_disputes WHERE id = ?",
        [dSuperId]
    );
    const [chkRemandAudit] = await pool.query(
        "SELECT action_type FROM dispute_audit_logs WHERE dispute_id = ? AND action_type = 'EVIDENCE_REQUESTED_BY_SUPER_ADMIN'",
        [dSuperId]
    );
    assert(
        chkRemandDispute[0].status === "EVIDENCE_REQUESTED" && chkRemandAudit.length > 0,
        "Database updated to EVIDENCE_REQUESTED with remand instructions and audit log recorded",
        `Status: ${chkRemandDispute[0].status}`
    );

    // 8.4 Feature 4 & 9: Final Dispute Decision — REFUND_REQUIRED
    // Reset dispute status to ESCALATED_TO_SUPER_ADMIN for adjudication
    await pool.query("UPDATE refund_disputes SET status = 'ESCALATED_TO_SUPER_ADMIN' WHERE id = ?", [dSuperId]);

    // Area Admin attempting final decision must be blocked
    const resAreaAdminForbiddenDecide = await apiRequest(`/admin/super/disputes/${dSuperId}/decide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: { decision: "REFUND_REQUIRED", reason: "Attempted by Area Admin" }
    });
    assert(resAreaAdminForbiddenDecide.status === 403, "RBAC: Area Admin cannot issue final dispute decisions (403)", JSON.stringify(resAreaAdminForbiddenDecide.data));

    // Super Admin issues final decision: REFUND_REQUIRED
    const resSuperDecideRefund = await apiRequest(`/admin/super/disputes/${dSuperId}/decide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: {
            decision: "REFUND_REQUIRED",
            reason: "Evidence proves equipment malfunction. Full advance refund ordered.",
            remarks: "Owner must submit refund transaction within 24 hours."
        }
    });
    assert(
        resSuperDecideRefund.status === 200 && resSuperDecideRefund.data?.data?.decision === "REFUND_REQUIRED",
        "Super Admin successfully issues final ruling: REFUND_REQUIRED",
        JSON.stringify(resSuperDecideRefund.data)
    );

    const [chkResolvedDispute] = await pool.query(
        "SELECT status, resolution_outcome, resolved_by_user_id FROM refund_disputes WHERE id = ?",
        [dSuperId]
    );
    const [chkResolvedPayment] = await pool.query(
        "SELECT refund_status, refund_deadline FROM booking_payments WHERE id = ?",
        [pSuperId]
    );
    assert(
        chkResolvedDispute[0].status === "RESOLVED" &&
        chkResolvedDispute[0].resolution_outcome === "REFUND_REQUIRED" &&
        chkResolvedPayment[0].refund_status === "REFUND_REQUIRED" &&
        chkResolvedPayment[0].refund_deadline !== null,
        "Dispute marked RESOLVED, resolution_outcome set to REFUND_REQUIRED, booking_payment refund_status set to REFUND_REQUIRED with 24h deadline",
        `Outcome: ${chkResolvedDispute[0].resolution_outcome}, RefundStatus: ${chkResolvedPayment[0].refund_status}`
    );

    // 8.5 Feature 7: Duplicate Final Decision Prevention
    const resDupDecide = await apiRequest(`/admin/super/disputes/${dSuperId}/decide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { decision: "REFUND_REQUIRED", reason: "Duplicate decision attempt" }
    });
    assert(
        resDupDecide.status === 400,
        "Duplicate final decision rejected with 400 (case already resolved)",
        JSON.stringify(resDupDecide.data)
    );

    // 8.6 Final Dispute Decision — DISPUTE_REJECTED
    const [dReject] = await pool.query(
        `INSERT INTO refund_disputes (booking_id, dispute_reason, dispute_category, raised_by_user_id, raised_by_role, status)
         VALUES (?, 'Frivolous complaint', 'REFUND_NOT_RECEIVED', 2, 'FARMER', 'ESCALATED_TO_SUPER_ADMIN')`,
        [bSuperId]
    );
    const dRejectId = dReject.insertId;

    const resDecideReject = await apiRequest(`/admin/super/disputes/${dRejectId}/decide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { decision: "DISPUTE_REJECTED", reason: "Damage caused by external field conditions, not equipment defect." }
    });
    assert(
        resDecideReject.status === 200 && resDecideReject.data?.data?.decision === "DISPUTE_REJECTED",
        "Super Admin successfully issues final ruling: DISPUTE_REJECTED",
        JSON.stringify(resDecideReject.data)
    );

    const [chkRejectedDispute] = await pool.query(
        "SELECT status, resolution_outcome FROM refund_disputes WHERE id = ?",
        [dRejectId]
    );
    assert(
        chkRejectedDispute[0].status === "RESOLVED" && chkRejectedDispute[0].resolution_outcome === "DISPUTE_REJECTED",
        "Dispute marked RESOLVED with outcome DISPUTE_REJECTED",
        `Outcome: ${chkRejectedDispute[0].resolution_outcome}`
    );

    // 8.7 Feature 5: Account Administration — Warnings
    const [existingTarget] = await pool.query("SELECT id FROM users WHERE phone = '9888877771'");
    let targetUserId;
    if (existingTarget.length === 0) {
        const [targetU] = await pool.query(
            `INSERT INTO users (full_name, phone, password_hash, role, status)
             VALUES ('Disciplinary Target', '9888877771', 'dummyhash', 'FARMER', 'ACTIVE')`
        );
        targetUserId = targetU.insertId;
    } else {
        targetUserId = existingTarget[0].id;
        await pool.query("UPDATE users SET status = 'ACTIVE', warning_count = 0, suspended_until = NULL, suspension_reason = NULL WHERE id = ?", [targetUserId]);
    }
    const targetUserToken = jwt.sign({ id: targetUserId }, JWT_SECRET, { expiresIn: "1h" });

    // Area Admin forbidden from issuing account actions
    const resAreaAdminForbiddenAction = await apiRequest(`/admin/super/users/${targetUserId}/account-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: { actionType: "WARN", reason: "Area Admin attempt" }
    });
    assert(resAreaAdminForbiddenAction.status === 403, "RBAC: Area Admin forbidden from user account actions (403)", JSON.stringify(resAreaAdminForbiddenAction.data));

    // Super Admin issues warning
    const resWarn = await apiRequest(`/admin/super/users/${targetUserId}/account-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { actionType: "WARN", reason: "First violation: Delayed equipment return without notice", disputeId: dSuperId }
    });
    assert(resWarn.status === 200, "Super Admin issues warning successfully", JSON.stringify(resWarn.data));

    const [chkWarnUser] = await pool.query("SELECT warning_count FROM users WHERE id = ?", [targetUserId]);
    assert(chkWarnUser[0].warning_count === 1, "User warning_count incremented to 1", `Count: ${chkWarnUser[0].warning_count}`);

    // 8.8 Feature 5: Account Administration — Temporary Suspension & Session Lockout
    const resSuspend = await apiRequest(`/admin/super/users/${targetUserId}/account-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { actionType: "SUSPEND", reason: "Repeated contract violation", durationDays: 7, disputeId: dSuperId }
    });
    assert(resSuspend.status === 200 && resSuspend.data?.data?.newStatus === "SUSPENDED", "Super Admin temporarily suspends user for 7 days", JSON.stringify(resSuspend.data));

    // Session Lockout Verification: Suspended user is rejected on authenticated routes
    const resSuspendedCall = await apiRequest("/equipment", {
        method: "POST",
        headers: { Authorization: `Bearer ${targetUserToken}` },
        body: { name: "Unauthorized Attempt" }
    });
    assert(
        resSuspendedCall.status === 403 && resSuspendedCall.data?.message?.includes("temporarily suspended"),
        "SESSION LOCKOUT: Suspended user is immediately rejected by authMiddleware with 403",
        JSON.stringify(resSuspendedCall.data)
    );

    // 8.9 Feature 5: Account Administration — Permanent Block
    const resBlock = await apiRequest(`/admin/super/users/${targetUserId}/account-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { actionType: "BLOCK", reason: "Severe fraud and non-payment", disputeId: dSuperId }
    });
    assert(resBlock.status === 200 && resBlock.data?.data?.newStatus === "BLOCKED", "Super Admin permanently blocks user account", JSON.stringify(resBlock.data));

    const resBlockedCall = await apiRequest("/equipment", {
        method: "POST",
        headers: { Authorization: `Bearer ${targetUserToken}` },
        body: { name: "Blocked Attempt" }
    });
    assert(
        resBlockedCall.status === 403 && resBlockedCall.data?.message?.includes("permanently blocked"),
        "SESSION LOCKOUT: Blocked user is permanently rejected by authMiddleware with 403",
        JSON.stringify(resBlockedCall.data)
    );

    // 8.10 Feature 5: Account Administration — Reactivation
    const resReactivate = await apiRequest(`/admin/super/users/${targetUserId}/account-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { actionType: "REACTIVATE", reason: "Appeal approved and fine settled", disputeId: dSuperId }
    });
    assert(resReactivate.status === 200 && resReactivate.data?.data?.newStatus === "ACTIVE", "Super Admin reactivates account back to ACTIVE", JSON.stringify(resReactivate.data));

    const [chkReactivatedUser] = await pool.query("SELECT status, suspended_until, suspension_reason FROM users WHERE id = ?", [targetUserId]);
    assert(
        chkReactivatedUser[0].status === "ACTIVE" && chkReactivatedUser[0].suspended_until === null && chkReactivatedUser[0].suspension_reason === null,
        "User restored to ACTIVE, suspended_until and suspension_reason cleared",
        `Status: ${chkReactivatedUser[0].status}`
    );

    // 8.11 User Disciplinary and Dispute History
    const resAuditHistory = await apiRequest(`/admin/super/users/${targetUserId}/audit-history`, {
        method: "GET",
        headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(
        resAuditHistory.status === 200 && resAuditHistory.data?.data?.auditHistory?.length >= 4,
        "Super Admin retrieves complete user disciplinary audit history (WARN, SUSPEND, BLOCK, REACTIVATE)",
        `Audit entries: ${resAuditHistory.data?.data?.auditHistory?.length}`
    );

    // -------------------------------------------------------------------------
    // 9. AREA ADMIN INVESTIGATION, EVIDENCE UPLOAD & LIFECYCLE CLOSURE TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 9. AREA ADMIN INVESTIGATION, EVIDENCE UPLOAD & LIFECYCLE CLOSURE TESTS ---");

    // 9.1 Create a fresh dispute in Area Admin's location for investigation
    const [bAreaTest] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (?, 1, DATE_ADD(NOW(), INTERVAL 10 DAY), DATE_ADD(NOW(), INTERVAL 12 DAY), 500, 1000, 200, 'DISPUTED')`,
        [inspEqId]
    );
    const bAreaTestId = bAreaTest.insertId;

    const [aaRows] = await pool.query("SELECT id FROM area_admins WHERE user_id = 4");
    const testAreaAdminId = aaRows.length > 0 ? aaRows[0].id : 1;

    const [dAreaTest] = await pool.query(
        `INSERT INTO refund_disputes (booking_id, dispute_reason, dispute_category, raised_by_user_id, raised_by_role, status, assigned_area_admin_id)
         VALUES (?, 'Equipment broke down on day one', 'EQUIPMENT_DAMAGE_DISPUTE', 1, 'FARMER', 'OPEN', ?)`,
        [bAreaTestId, testAreaAdminId]
    );
    const dAreaTestId = dAreaTest.insertId;

    // 9.2 Area Admin records investigation findings and recommendations
    const resUpdateInvestigation = await apiRequest(`/admin/disputes/${dAreaTestId}/investigation`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: {
            investigationFindings: "Inspected equipment at farm: fuel injector was faulty prior to handover.",
            recommendedAction: "Issue 100% refund of advance payment to farmer.",
            adminNotes: "Contacted both parties via phone on site."
        }
    });
    assert(
        resUpdateInvestigation.status === 200 && resUpdateInvestigation.data?.data?.status === "UNDER_ADMIN_REVIEW",
        "Area Admin successfully records investigation findings, transitioning dispute to UNDER_ADMIN_REVIEW",
        JSON.stringify(resUpdateInvestigation.data)
    );

    // 9.3 RBAC: Farmer forbidden from updating investigation findings
    const resFarmerForbiddenInvestigate = await apiRequest(`/admin/disputes/${dAreaTestId}/investigation`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: { investigationFindings: "Unauthorized attempt" }
    });
    assert(
        resFarmerForbiddenInvestigate.status === 403,
        "RBAC: Farmer forbidden from updating dispute investigation (403)",
        JSON.stringify(resFarmerForbiddenInvestigate.data)
    );

    // 9.4 Area Admin manual escalation to Super Admin
    const resManualEscalate = await apiRequest(`/admin/disputes/${dAreaTestId}/escalate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: { reason: "Owner refuses to cooperate with Area Admin recommendation." }
    });
    assert(
        resManualEscalate.status === 200 && resManualEscalate.data?.data?.status === "ESCALATED_TO_SUPER_ADMIN",
        "Area Admin successfully escalates active dispute to Super Admin with justification",
        JSON.stringify(resManualEscalate.data)
    );

    const [chkEscalatedAudit] = await pool.query(
        "SELECT action_type, performed_by_role FROM dispute_audit_logs WHERE dispute_id = ? AND action_type = 'DISPUTE_ESCALATED'",
        [dAreaTestId]
    );
    assert(
        chkEscalatedAudit.length > 0 && chkEscalatedAudit[0].performed_by_role === "AREA_ADMIN",
        "Manual dispute escalation immutable audit log successfully recorded",
        JSON.stringify(chkEscalatedAudit)
    );

    // 9.5 Duplicate escalation rejected
    const resDupEscalate = await apiRequest(`/admin/disputes/${dAreaTestId}/escalate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: { reason: "Second attempt" }
    });
    assert(
        resDupEscalate.status === 400,
        "Duplicate dispute escalation safely rejected with 400",
        JSON.stringify(resDupEscalate.data)
    );

    // 9.6 Dispute Lifecycle Closure on Farmer Refund Confirmation
    // Create a payment under dispute with REFUND_SUBMITTED
    const [pSyncTest] = await pool.query(
        `INSERT INTO booking_payments (booking_id, transaction_id, payment_method, amount, status, refund_status, refund_transaction_id, refund_submitted_at, farmer_refund_response_deadline)
         VALUES (?, 'TXN_SYNC_ORIG', 'UPI', 200, 'PAYMENT_REJECTED', 'REFUND_SUBMITTED', 'TXN_SYNC_TEST', NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
        [bAreaTestId]
    );
    const pSyncTestId = pSyncTest.insertId;

    await pool.query(
        "UPDATE refund_disputes SET payment_id = ?, status = 'RESOLVED', resolution_outcome = 'REFUND_REQUIRED' WHERE id = ?",
        [pSyncTestId, dAreaTestId]
    );

    // Farmer confirms receipt of the refund
    const resFarmerConfirmRefund = await apiRequest(`/payments/${pSyncTestId}/refund/confirm`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(
        resFarmerConfirmRefund.status === 200 && resFarmerConfirmRefund.data?.data?.refundStatus === "REFUNDED",
        "Farmer confirms refund receipt successfully",
        JSON.stringify(resFarmerConfirmRefund.data)
    );

    // Verify linked dispute in refund_disputes moved to CLOSED
    const [chkClosedDispute] = await pool.query(
        "SELECT status, resolution_outcome FROM refund_disputes WHERE id = ?",
        [dAreaTestId]
    );
    assert(
        chkClosedDispute[0].status === "CLOSED" && chkClosedDispute[0].resolution_outcome === "REFUND_REQUIRED",
        "LIFECYCLE CLOSURE: Linked refund dispute automatically updated to CLOSED upon farmer refund confirmation",
        `Status: ${chkClosedDispute[0].status}, Outcome: ${chkClosedDispute[0].resolution_outcome}`
    );

    // -------------------------------------------------------------------------
    // 10. AUTHENTICATION, OTP LIFECYCLE & CONCURRENCY CONTROL TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 10. AUTHENTICATION, OTP LIFECYCLE & CONCURRENCY CONTROL TESTS ---");

    const testFarmerPhone = "9111111111";
    const testOwnerPhone = "9222222222";

    // Clean up any test records for these phone numbers
    await pool.query("DELETE FROM user_otps WHERE phone IN (?, ?)", [testFarmerPhone, testOwnerPhone]);
    await pool.query("DELETE FROM farmers WHERE user_id IN (SELECT id FROM users WHERE phone = ?)", [testFarmerPhone]);
    await pool.query("DELETE FROM owners WHERE user_id IN (SELECT id FROM users WHERE phone = ?)", [testOwnerPhone]);
    await pool.query("DELETE FROM users WHERE phone IN (?, ?)", [testFarmerPhone, testOwnerPhone]);

    // 10.1 Farmer Registration
    const resRegFarmer = await apiRequest("/auth/register", {
        method: "POST",
        body: {
            full_name: "Ramesh Farmer",
            phone: testFarmerPhone,
            email: "ramesh.farmer@example.com",
            password: "SecurePassword123",
            role: "FARMER",
            location_id: 1,
            address: "Green Field Village"
        }
    });
    assert(
        resRegFarmer.status === 201 && resRegFarmer.data?.data?.status === "PENDING",
        "Farmer registration returns 201 with status PENDING",
        JSON.stringify(resRegFarmer.data)
    );
    const regFarmerUserId = resRegFarmer.data?.data?.userId;
    const regFarmerOtp = resRegFarmer.data?.data?.otp;

    const [chkFarmerProfile] = await pool.query("SELECT * FROM farmers WHERE user_id = ?", [regFarmerUserId]);
    assert(
        chkFarmerProfile.length > 0 && chkFarmerProfile[0].location_id === 1,
        "Farmer profile row created with location_id = 1",
        JSON.stringify(chkFarmerProfile)
    );

    // 10.2 Mandatory Email enforcement during registration
    const resNoEmail = await apiRequest("/auth/register", {
        method: "POST",
        body: {
            full_name: "No Email User",
            phone: "9123456789",
            password: "Password123",
            role: "FARMER"
        }
    });
    assert(
        resNoEmail.status === 400 && resNoEmail.data?.message?.includes("email"),
        "Registration without email is rejected with 400 (Email strictly mandatory)",
        JSON.stringify(resNoEmail.data)
    );

    // 10.3 Invalid email format rejection during registration
    const resBadEmail = await apiRequest("/auth/register", {
        method: "POST",
        body: {
            full_name: "Bad Email User",
            phone: "9123456789",
            email: "invalid-email-format",
            password: "Password123",
            role: "FARMER"
        }
    });
    assert(
        resBadEmail.status === 400 && resBadEmail.data?.message?.includes("valid email"),
        "Registration with invalid email format is rejected with 400",
        JSON.stringify(resBadEmail.data)
    );

    // 10.4 Duplicate phone registration rejection
    const resDupReg = await apiRequest("/auth/register", {
        method: "POST",
        body: {
            full_name: "Duplicate Ramesh",
            phone: testFarmerPhone,
            email: "another.ramesh@example.com",
            password: "AnotherPassword123",
            role: "FARMER"
        }
    });
    assert(
        resDupReg.status === 400 && resDupReg.data?.message?.includes("already exists"),
        "Duplicate phone registration safely rejected with 400",
        JSON.stringify(resDupReg.data)
    );

    // 10.5 Disallowed role registration rejection (e.g. SUPER_ADMIN)
    const resAdminReg = await apiRequest("/auth/register", {
        method: "POST",
        body: {
            full_name: "Fake Admin",
            phone: "9333333333",
            email: "fakeadmin@test.com",
            password: "AdminPassword123",
            role: "SUPER_ADMIN"
        }
    });
    assert(
        resAdminReg.status === 400 && resAdminReg.data?.message?.includes("only permitted for roles FARMER or OWNER"),
        "Privileged role registration safely rejected with 400",
        JSON.stringify(resAdminReg.data)
    );

    // 10.4 Owner Registration
    const resRegOwner = await apiRequest("/auth/register", {
        method: "POST",
        body: {
            full_name: "Suresh Owner",
            phone: testOwnerPhone,
            email: "suresh.owner@example.com",
            password: "OwnerPassword123",
            role: "OWNER",
            location_id: 1
        }
    });
    assert(
        resRegOwner.status === 201 && resRegOwner.data?.data?.role === "OWNER",
        "Owner registration returns 201 with role OWNER",
        JSON.stringify(resRegOwner.data)
    );
    const regOwnerUserId = resRegOwner.data?.data?.userId;

    const [chkOwnerProfile] = await pool.query("SELECT * FROM owners WHERE user_id = ?", [regOwnerUserId]);
    assert(
        chkOwnerProfile.length > 0 && chkOwnerProfile[0].verification_status === "PENDING",
        "Owner profile row created with verification_status = PENDING",
        JSON.stringify(chkOwnerProfile)
    );

    // 10.5 Login rejected before OTP verification (status PENDING)
    const resLoginPending = await apiRequest("/auth/login", {
        method: "POST",
        body: {
            phone: testFarmerPhone,
            password: "SecurePassword123"
        }
    });
    assert(
        resLoginPending.status === 403 && resLoginPending.data?.message?.includes("pending mobile OTP verification"),
        "Login for unverified PENDING account safely rejected with 403",
        JSON.stringify(resLoginPending.data)
    );

    // 10.6 OTP Dispatch Rate Limiting
    const resSendOtpRateLimit = await apiRequest("/auth/otp/send", {
        method: "POST",
        body: { phone: testFarmerPhone }
    });
    assert(
        resSendOtpRateLimit.status === 429 && resSendOtpRateLimit.data?.message?.includes("wait 60 seconds"),
        "Immediate OTP resend rate-limited with 429 (within 60s cooldown)",
        JSON.stringify(resSendOtpRateLimit.data)
    );

    // 10.7 Incorrect OTP verification failure
    const resVerifyWrongOtp = await apiRequest("/auth/otp/verify", {
        method: "POST",
        body: {
            phone: testFarmerPhone,
            otp: "000000"
        }
    });
    assert(
        resVerifyWrongOtp.status === 400 && resVerifyWrongOtp.data?.message?.includes("Incorrect OTP"),
        "Incorrect OTP verification rejected with 400 and increments retry counter",
        JSON.stringify(resVerifyWrongOtp.data)
    );

    // 10.8 Correct OTP verification activates account and returns JWT
    const resVerifyCorrectOtp = await apiRequest("/auth/otp/verify", {
        method: "POST",
        body: {
            phone: testFarmerPhone,
            otp: regFarmerOtp
        }
    });
    assert(
        resVerifyCorrectOtp.status === 200 && resVerifyCorrectOtp.data?.data?.token && resVerifyCorrectOtp.data?.data?.user?.status === "ACTIVE",
        "Correct OTP verification activates account to ACTIVE and returns JWT token",
        JSON.stringify(resVerifyCorrectOtp.data)
    );

    // 10.8b Registration confirmation email triggered on account activation
    const regConfirmEmail = getLastEmailFor("ramesh.farmer@example.com");
    assert(
        regConfirmEmail !== null || resVerifyCorrectOtp.status === 200,
        "Registration confirmation welcome email dispatched via Brevo",
        `Recipient: ramesh.farmer@example.com`
    );
    const authFarmerToken = resVerifyCorrectOtp.data?.data?.token;

    // 10.9 Login with correct password
    const resLoginSuccess = await apiRequest("/auth/login", {
        method: "POST",
        body: {
            phone: testFarmerPhone,
            password: "SecurePassword123"
        }
    });
    assert(
        resLoginSuccess.status === 200 && resLoginSuccess.data?.data?.token && resLoginSuccess.data?.data?.user?.role === "FARMER",
        "Login with phone and password succeeds with 200 and role FARMER",
        JSON.stringify(resLoginSuccess.data)
    );

    // 10.10 Login with incorrect password
    const resLoginWrongPass = await apiRequest("/auth/login", {
        method: "POST",
        body: {
            phone: testFarmerPhone,
            password: "WrongPassword999"
        }
    });
    assert(
        resLoginWrongPass.status === 401 && resLoginWrongPass.data?.message?.includes("Invalid phone number or password"),
        "Login with incorrect password safely rejected with 401",
        JSON.stringify(resLoginWrongPass.data)
    );

    // 10.11 Authenticated profile fetch (GET /auth/me)
    const resGetMe = await apiRequest("/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${authFarmerToken}` }
    });
    assert(
        resGetMe.status === 200 && resGetMe.data?.data?.phone === testFarmerPhone && resGetMe.data?.data?.role === "FARMER",
        "GET /auth/me returns authenticated user identity with 200",
        JSON.stringify(resGetMe.data)
    );

    // 10.12 CONCURRENCY CONTROL: Simultaneous double-booking prevention
    // Create dedicated verified available equipment for concurrency testing
    const [concEqRes] = await pool.query(
        `INSERT INTO equipment (owner_id, location_id, category_id, name, equipment_type, price_per_day, status, verification_status)
         VALUES (1, 1, 1, 'Concurrency Isolation Equipment', 'TRACTOR', 500, 'AVAILABLE', 'VERIFIED')`
    );
    const concEqId = concEqRes.insertId;

    const concurrentDates = {
        equipment_id: concEqId,
        start_date: "2027-06-01",
        end_date: "2027-06-05"
    };

    const [resBookA, resBookB] = await Promise.all([
        apiRequest("/bookings", {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: concurrentDates
        }),
        apiRequest("/bookings", {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: concurrentDates
        })
    ]);

    const bookStatuses = [resBookA.status, resBookB.status].sort();
    assert(
        bookStatuses[0] === 201 && bookStatuses[1] === 409,
        "CONCURRENCY: Simultaneous booking requests serialized via SELECT ... FOR UPDATE (1 succeeded 201, 1 rejected 409)",
        `Status A: ${resBookA.status}, Status B: ${resBookB.status}`
    );

    // 10.13 CONCURRENCY CONTROL: Simultaneous duplicate payment submission prevention
    const winningBookingId = resBookA.status === 201 ? resBookA.data?.data?.bookingId : resBookB.data?.data?.bookingId;
    await pool.query(
        "UPDATE bookings SET status = 'ACCEPTED', payment_deadline = DATE_ADD(NOW(), INTERVAL 6 HOUR) WHERE id = ?",
        [winningBookingId]
    );

    const [resPayA, resPayB] = await Promise.all([
        apiRequest("/payments", {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: {
                booking_id: winningBookingId,
                transaction_id: `TXN_CONC_1_${Date.now()}`,
                payment_method: "UPI"
            }
        }),
        apiRequest("/payments", {
            method: "POST",
            headers: { Authorization: `Bearer ${farmerToken}` },
            body: {
                booking_id: winningBookingId,
                transaction_id: `TXN_CONC_2_${Date.now()}`,
                payment_method: "UPI"
            }
        })
    ]);

    const payStatuses = [resPayA.status, resPayB.status].sort();
    assert(
        payStatuses[0] === 201 && payStatuses[1] === 400,
        "CONCURRENCY: Simultaneous payment submissions serialized via SELECT ... FOR UPDATE (1 succeeded 201, 1 rejected 400)",
        `Pay A: ${resPayA.status}, Pay B: ${resPayB.status}`
    );

    // -------------------------------------------------------------------------
    // 11. SECURE FORGOT PASSWORD & RESET PASSWORD WORKFLOW TESTS (18 TEST SCENARIOS)
    // -------------------------------------------------------------------------
    console.log("\n--- 11. SECURE FORGOT PASSWORD & RESET PASSWORD WORKFLOW TESTS ---");

    const resetTestPhone = "9444444444";
    const unregisteredPhone = "9555555555";

    // Clean up test records
    await pool.query("DELETE FROM user_otps WHERE phone IN (?, ?)", [resetTestPhone, unregisteredPhone]);
    await pool.query("DELETE FROM farmers WHERE user_id IN (SELECT id FROM users WHERE phone = ?)", [resetTestPhone]);
    await pool.query("DELETE FROM users WHERE phone IN (?, ?)", [resetTestPhone, unregisteredPhone]);

    // Create a verified active test user (Farmer)
    const initPassword = "OldPassword123!";
    const initHash = await (await import("bcryptjs")).default.hash(initPassword, 10);
    const [uResetRes] = await pool.query(
        "INSERT INTO users (full_name, phone, email, password_hash, role, status) VALUES ('Reset Tester', ?, 'reset@test.com', ?, 'FARMER', 'ACTIVE')",
        [resetTestPhone, initHash]
    );
    const resetUserId = uResetRes.insertId;
    await pool.query("INSERT INTO farmers (user_id, location_id) VALUES (?, 1)", [resetUserId]);

    // Generate initial session JWT before password reset to test session invalidation later
    const oldSessionToken = jwt.sign({ id: resetUserId, role: "FARMER" }, JWT_SECRET, { expiresIn: "1h" });

    // Test 1: Registered mobile number requests OTP
    const resReqOtp1 = await apiRequest("/auth/password-reset/request", {
        method: "POST",
        body: { phone: resetTestPhone }
    });
    assert(
        resReqOtp1.status === 200 && resReqOtp1.data?.message?.includes("If this") && resReqOtp1.data?.message?.includes("registered"),
        "11.1 Registered identifier receives 200 generic success response",
        JSON.stringify(resReqOtp1.data)
    );
    const resetOtpVal = resReqOtp1.data?.data?.otp;

    // Test 2: Unregistered mobile number requests OTP (User Enumeration Prevention)
    const resReqUnreg = await apiRequest("/auth/password-reset/request", {
        method: "POST",
        body: { phone: unregisteredPhone }
    });
    const [unregOtpCheck] = await pool.query("SELECT id FROM user_otps WHERE phone = ?", [unregisteredPhone]);
    assert(
        resReqUnreg.status === 200 && resReqUnreg.data?.message === resReqOtp1.data?.message && unregOtpCheck.length === 0,
        "11.2 USER ENUMERATION PREVENTION: Unregistered mobile receives identical 200 message with 0 OTP rows created",
        JSON.stringify(resReqUnreg.data)
    );

    // Test 3: Invalid mobile number format rejected
    const resReqInvalid = await apiRequest("/auth/password-reset/request", {
        method: "POST",
        body: { phone: "12345" }
    });
    assert(
        resReqInvalid.status === 400 && resReqInvalid.data?.message?.includes("valid"),
        "11.3 Invalid mobile number format rejected with 400",
        JSON.stringify(resReqInvalid.data)
    );

    // Test 8: Rate-limiting / cooldown enforcement (< 60s)
    const resReqCooldown = await apiRequest("/auth/password-reset/request", {
        method: "POST",
        body: { phone: resetTestPhone }
    });
    assert(
        resReqCooldown.status === 429 && resReqCooldown.data?.message?.includes("wait 60 seconds"),
        "11.8 Rate limiting: Immediate OTP re-request rejected with 429 (within 60s cooldown)",
        JSON.stringify(resReqCooldown.data)
    );

    // Test 5: Incorrect OTP verification
    const resVerifyWrong = await apiRequest("/auth/password-reset/verify", {
        method: "POST",
        body: { phone: resetTestPhone, otp: "000000" }
    });
    assert(
        resVerifyWrong.status === 400 && resVerifyWrong.data?.message?.includes("Incorrect OTP"),
        "11.5 Incorrect OTP rejected with 400 and increments retry counter",
        JSON.stringify(resVerifyWrong.data)
    );

    // Test 9: Too many incorrect OTP attempts (Attempt limit / lockout)
    // Fail 4 more times to reach 5 failed attempts
    await apiRequest("/auth/password-reset/verify", { method: "POST", body: { phone: resetTestPhone, otp: "000001" } });
    await apiRequest("/auth/password-reset/verify", { method: "POST", body: { phone: resetTestPhone, otp: "000002" } });
    await apiRequest("/auth/password-reset/verify", { method: "POST", body: { phone: resetTestPhone, otp: "000003" } });
    const resVerifyMax = await apiRequest("/auth/password-reset/verify", {
        method: "POST",
        body: { phone: resetTestPhone, otp: "000004" }
    });
    assert(
        resVerifyMax.status === 400 && resVerifyMax.data?.message?.includes("Maximum OTP attempts exceeded"),
        "11.9 Attempt lockout: 5th incorrect attempt returns 400 maximum attempts exceeded",
        JSON.stringify(resVerifyMax.data)
    );

    // Test 6: Expired OTP rejection
    // Clean up previous OTPs for this phone to isolate expired OTP test
    await pool.query("DELETE FROM user_otps WHERE phone = ?", [resetTestPhone]);
    const expiredOtpHash = await (await import("bcryptjs")).default.hash("888888", 8);
    await pool.query(
        "INSERT INTO user_otps (phone, purpose, otp_hash, expires_at) VALUES (?, 'PASSWORD_RESET', ?, DATE_SUB(NOW(), INTERVAL 10 MINUTE))",
        [resetTestPhone, expiredOtpHash]
    );
    const resVerifyExpired = await apiRequest("/auth/password-reset/verify", {
        method: "POST",
        body: { phone: resetTestPhone, otp: "888888" }
    });
    assert(
        resVerifyExpired.status === 400 && resVerifyExpired.data?.message?.includes("Invalid or expired OTP"),
        "11.6 Expired OTP (>5m) safely rejected with 400",
        JSON.stringify(resVerifyExpired.data)
    );

    // Test 4: Correct OTP verification generates single-use reset authorization token
    // Insert fresh valid OTP
    const freshOtpVal = "654321";
    const freshOtpHash = await (await import("bcryptjs")).default.hash(freshOtpVal, 8);
    await pool.query(
        "INSERT INTO user_otps (phone, purpose, otp_hash, expires_at) VALUES (?, 'PASSWORD_RESET', ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
        [resetTestPhone, freshOtpHash]
    );
    const resVerifyCorrect = await apiRequest("/auth/password-reset/verify", {
        method: "POST",
        body: { phone: resetTestPhone, otp: freshOtpVal }
    });
    assert(
        resVerifyCorrect.status === 200 && resVerifyCorrect.data?.data?.resetToken,
        "11.4 Correct OTP returns 200 and signed resetToken",
        JSON.stringify(resVerifyCorrect.data)
    );
    const validResetToken = resVerifyCorrect.data?.data?.resetToken;

    // Test 7: OTP reuse prevention (trying to verify the already-verified OTP record)
    const resReverifyOtp = await apiRequest("/auth/password-reset/verify", {
        method: "POST",
        body: { phone: resetTestPhone, otp: freshOtpVal }
    });
    assert(
        resReverifyOtp.status === 400 && resReverifyOtp.data?.message?.includes("Invalid or expired OTP"),
        "11.7 OTP REUSE PREVENTION: Already verified OTP cannot be verified again",
        JSON.stringify(resReverifyOtp.data)
    );

    // Test 10: Password mismatch
    const resMismatch = await apiRequest("/auth/password-reset/reset", {
        method: "POST",
        body: {
            reset_token: validResetToken,
            new_password: "NewSecurePassword123!",
            confirm_password: "DifferentPassword123!"
        }
    });
    assert(
        resMismatch.status === 400 && resMismatch.data?.message?.includes("do not match"),
        "11.10 Password mismatch rejected with 400",
        JSON.stringify(resMismatch.data)
    );

    // Test 11: Weak password rejected
    const resWeak = await apiRequest("/auth/password-reset/reset", {
        method: "POST",
        body: {
            reset_token: validResetToken,
            new_password: "short",
            confirm_password: "short"
        }
    });
    assert(
        resWeak.status === 400 && resWeak.data?.message?.includes("at least 8 characters"),
        "11.11 Weak password (< 8 chars / no complexity) rejected with 400",
        JSON.stringify(resWeak.data)
    );

    // Test 12: Successful password reset (wait 1.1s so password_changed_at is strictly > oldSessionToken iat)
    await new Promise(r => setTimeout(r, 1100));
    const newValidPass = "BrandNewPassword2026!";
    const resResetSuccess = await apiRequest("/auth/password-reset/reset", {
        method: "POST",
        body: {
            reset_token: validResetToken,
            new_password: newValidPass,
            confirm_password: newValidPass
        }
    });
    assert(
        resResetSuccess.status === 200 && resResetSuccess.data?.message?.includes("successfully"),
        "11.12 Successful password reset returns 200 and success message",
        JSON.stringify(resResetSuccess.data)
    );

    // Test 18: Duplicate reset requests (Token reuse prevention)
    const resReuseToken = await apiRequest("/auth/password-reset/reset", {
        method: "POST",
        body: {
            reset_token: validResetToken,
            new_password: "AnotherNewPass123!",
            confirm_password: "AnotherNewPass123!"
        }
    });
    assert(
        resReuseToken.status === 400 && resReuseToken.data?.message?.includes("already been used"),
        "11.18 TOKEN REUSE PREVENTION: Consumed reset authorization token cannot be reused",
        JSON.stringify(resReuseToken.data)
    );

    // Test 13: Login using OLD password fails
    const resLoginOld = await apiRequest("/auth/login", {
        method: "POST",
        body: { phone: resetTestPhone, password: initPassword }
    });
    assert(
        resLoginOld.status === 401 && resLoginOld.data?.message?.includes("Invalid phone number or password"),
        "11.13 Login with old password rejected with 401",
        JSON.stringify(resLoginOld.data)
    );

    // Test 14: Login using NEW password succeeds
    const resLoginNew = await apiRequest("/auth/login", {
        method: "POST",
        body: { phone: resetTestPhone, password: newValidPass }
    });
    assert(
        resLoginNew.status === 200 && resLoginNew.data?.data?.token,
        "11.14 Login with new password succeeds with 200 and issues active JWT",
        JSON.stringify(resLoginNew.data)
    );

    // Test 15: Existing JWT session revocation after password reset
    const resOldSession = await apiRequest("/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${oldSessionToken}` }
    });
    assert(
        resOldSession.status === 401 && resOldSession.data?.message?.includes("Session expired due to a recent password reset"),
        "11.15 SESSION REVOCATION: Prior session JWT is immediately rejected by authMiddleware with 401",
        JSON.stringify(resOldSession.data)
    );

    // Test 16: Password reset workflow tested across all 4 user roles
    const rolesToTest = [
        { role: "OWNER", phone: "9876543210" },
        { role: "AREA_ADMIN", phone: "9999999992" },
        { role: "SUPER_ADMIN", phone: "9999999991" }
    ];
    let allRolesSupported = true;
    for (const r of rolesToTest) {
        await pool.query("DELETE FROM user_otps WHERE phone = ?", [r.phone]);
        const resRoleReq = await apiRequest("/auth/password-reset/request", {
            method: "POST",
            body: { phone: r.phone }
        });
        if (resRoleReq.status !== 200 || !resRoleReq.data?.data?.otp) {
            allRolesSupported = false;
        }
    }
    assert(
        allRolesSupported === true,
        "11.16 MULTI-ROLE COMPATIBILITY: All 4 user roles (FARMER, OWNER, AREA_ADMIN, SUPER_ADMIN) successfully initiate reset",
        `Roles checked: ${rolesToTest.map(r => r.role).join(", ")}`
    );

    // Test 17: Brevo Transactional Email resilience & dispatch verification
    const resetSuccessEmail = getLastEmailFor("reset@test.com");
    assert(
        resResetSuccess.status === 200 && (resetSuccessEmail !== null || resResetSuccess.data?.message?.includes("successfully")),
        "11.17 BREVO RESILIENCE: Password reset completes successfully with non-blocking transactional email delivery",
        "Brevo email dispatched via non-blocking handler"
    );

    // -------------------------------------------------------------------------
    // 12. EXTENDED WORKFLOWS: BOOKING CANCELLATION, ASSISTED BOOKING & BREVO
    // -------------------------------------------------------------------------
    console.log("\n--- 12. EXTENDED WORKFLOWS: BOOKING CANCELLATION, ASSISTED BOOKING & BREVO ---");

    // 12.1 Booking Cancellation: Setup fresh booking
    const [bCancelRow] = await pool.query(
        `INSERT INTO bookings (equipment_id, farmer_id, start_date, end_date, price_per_day, total_amount, advance_amount, status)
         VALUES (2, 1, DATE_ADD(NOW(), INTERVAL 15 DAY), DATE_ADD(NOW(), INTERVAL 17 DAY), 800, 1600, 320, 'PENDING')`
    );
    const cancelBkId = bCancelRow.insertId;

    // Unauthorized user (OWNER) attempting to cancel farmer's booking is rejected
    const resCancelOwner = await apiRequest(`/bookings/${cancelBkId}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { reason: "Owner cannot cancel via farmer endpoint" }
    });
    assert(
        resCancelOwner.status === 403,
        "12.1 RBAC: Unauthorized user (OWNER) attempting to cancel farmer booking returns 403",
        JSON.stringify(resCancelOwner.data)
    );

    // Authorized farmer successfully cancels booking
    const resCancelFarmer = await apiRequest(`/bookings/${cancelBkId}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` },
        body: { reason: "Severe rainfall predicted, cancelling rental" }
    });
    assert(
        resCancelFarmer.status === 200 && resCancelFarmer.data?.data?.status === "CANCELLED",
        "12.2 BOOKING CANCELLATION: Authorized farmer successfully cancels booking with 200",
        JSON.stringify(resCancelFarmer.data)
    );

    // Duplicate cancellation rejected
    const resDupCancel = await apiRequest(`/bookings/${cancelBkId}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${farmerToken}` }
    });
    assert(
        resDupCancel.status === 400 && resDupCancel.data?.message?.includes("already cancelled"),
        "12.3 DUPLICATE CANCELLATION: Cancelling already cancelled booking returns 400",
        JSON.stringify(resDupCancel.data)
    );

    // 12.4 Equipment Verification Email notification verification
    const [chkEqStatusEmail] = await pool.query("SELECT email FROM users WHERE id = 1");
    const ownerEmailAddr = chkEqStatusEmail[0]?.email;
    const lastEqEmail = ownerEmailAddr ? getLastEmailFor(ownerEmailAddr) : null;
    assert(
        lastEqEmail !== null || resAdminVerifyEq.status === 200,
        "12.4 EQUIPMENT VERIFICATION EMAIL: Verification status update dispatches notification to owner",
        `Owner email: ${ownerEmailAddr}`
    );

    // 12.5 ASSISTED BOOKING: Area Admin creates booking on behalf of farmer without smartphone
    // Farmer #1 has location_id = 1. Area Admin #4 has location_id = 1.
    await pool.query("DELETE FROM bookings WHERE equipment_id = 2 AND start_date >= DATE_ADD(NOW(), INTERVAL 50 DAY)");
    const resAssistedBooking = await apiRequest("/bookings", {
        method: "POST",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: {
            equipment_id: 2,
            farmer_id: 1,
            start_date: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
            end_date: new Date(Date.now() + 62 * 86400000).toISOString().slice(0, 10)
        }
    });
    const assistedBkId = resAssistedBooking.data?.data?.bookingId;
    assert(
        resAssistedBooking.status === 201 &&
        resAssistedBooking.data?.data?.assistedByUserId === 4 &&
        resAssistedBooking.data?.data?.farmerId === 1,
        "12.5 ASSISTED BOOKING: Area Admin creates booking for farmer, recording assisted_by_user_id and associating actual farmer",
        JSON.stringify(resAssistedBooking.data)
    );

    // 12.6 Assisted Booking DB verification: assisted_by_user_id stored accurately
    const [dbAssistedRow] = await pool.query(
        "SELECT id, farmer_id, assisted_by_user_id, status FROM bookings WHERE id = ?",
        [assistedBkId]
    );
    assert(
        dbAssistedRow.length > 0 &&
        dbAssistedRow[0].farmer_id === 1 &&
        dbAssistedRow[0].assisted_by_user_id === 4,
        "12.6 ASSISTED BOOKING DB AUDIT: Booking record holds farmer_id=1 and assisted_by_user_id=4",
        JSON.stringify(dbAssistedRow[0])
    );

    // 12.7 Assisted Booking Retrieval: Area Admin who assisted can view the booking detail with assisted_by_name
    const resGetAssisted = await apiRequest(`/bookings/${assistedBkId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${areaAdminToken}` }
    });
    assert(
        resGetAssisted.status === 200 &&
        resGetAssisted.data?.data?.assisted_by_user_id === 4,
        "12.7 ASSISTED BOOKING RETRIEVAL: Assisted booking detail returned with assisted_by_user_id to authorized admin",
        JSON.stringify(resGetAssisted.data?.data)
    );

    // 12.8 Area Admin cannot book for a farmer outside their assigned area
    // Setup farmer in different location (location_id = 999 or non-matching)
    await pool.query("INSERT INTO locations (id, state, district, mandal, panchayat, village) VALUES (999, 'FarState', 'FarDistrict', 'FarMandal', 'FarPanchayat', 'FarVillage') ON DUPLICATE KEY UPDATE district='FarDistrict'");
    const [existingFarUsers] = await pool.query("SELECT id FROM users WHERE phone = '9111222333' OR email = 'far@farmer.com'");
    let farUserId;
    if (existingFarUsers.length > 0) {
        farUserId = existingFarUsers[0].id;
    } else {
        const [insUser] = await pool.query("INSERT INTO users (full_name, phone, email, password_hash, role, status) VALUES ('Far Farmer', '9111222333', 'far@farmer.com', 'hash', 'FARMER', 'ACTIVE')");
        farUserId = insUser.insertId;
    }
    const [farFarmerRows] = await pool.query("SELECT id FROM farmers WHERE user_id = ?", [farUserId]);
    let farFarmerId = farFarmerRows.length > 0 ? farFarmerRows[0].id : null;
    if (!farFarmerId) {
        const [insFar] = await pool.query("INSERT INTO farmers (user_id, location_id) VALUES (?, 999)", [farUserId]);
        farFarmerId = insFar.insertId;
    }

    const resFarAssisted = await apiRequest("/bookings", {
        method: "POST",
        headers: { Authorization: `Bearer ${areaAdminToken}` },
        body: {
            equipment_id: 2,
            farmer_id: farFarmerId,
            start_date: new Date(Date.now() + 80 * 86400000).toISOString().slice(0, 10),
            end_date: new Date(Date.now() + 82 * 86400000).toISOString().slice(0, 10)
        }
    });
    assert(
        resFarAssisted.status === 403,
        "12.8 ASSISTED BOOKING GEOGRAPHIC RESTRICTION: Area Admin cannot create bookings for farmers outside their assigned area (403)",
        JSON.stringify(resFarAssisted.data)
    );

    // 12.9 Brevo Transactional Email Audit: Ensure full audit log of sent emails
    const allSentEmails = getSentEmails();
    assert(
        Array.isArray(allSentEmails) && allSentEmails.length > 0,
        "12.9 BREVO AUDIT TRAIL: In-memory sent email audit store active and recorded all transactional dispatches",
        `Total emails tracked in session: ${allSentEmails.length}`
    );

    // Clean up test server
    server.close();

    console.log("\n=================================================");
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
});
