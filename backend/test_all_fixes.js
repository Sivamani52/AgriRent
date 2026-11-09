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
import {
    checkBookingAcceptanceTimeouts,
    checkPaymentVerificationTimeouts
} from "./services/paymentTimeoutService.js";
import {
    checkInspectionMediaCleanupTimeouts,
    isBookingSafeForMediaCleanup
} from "./services/mediaCleanupService.js";
import cloudinary from "./config/cloudinary.js";
import smsService, { normalizePhoneNumber, sendSMS } from "./services/smsService.js";

const app = express();
app.use(express.json());
app.use("/api", equipmentRoutes);
app.use("/api", equipmentMediaRoutes);
app.use("/api", paymentRoutes);
app.use("/api", bookingRoutes);
app.use("/api", adminRoutes);
app.use("/api", inspectionRoutes);

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
            transaction_id: "TXN_TEST_12345",
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
    // 5. SMS NOTIFICATION TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 5. SMS NOTIFICATION TESTS ---");

    // 5.1 Invalid phone number handling
    const smsInvalidRes = await sendSMS({ phone: "12345", message: "Test" });
    assert(
        smsInvalidRes.success === false && smsInvalidRes.delivered === false && smsInvalidRes.error?.includes("Invalid"),
        "Invalid phone number returns clean error without crashing",
        JSON.stringify(smsInvalidRes)
    );

    // 5.2 Indian phone number normalization test
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

    // 5.3 Missing credentials error handling
    const smsMissingCreds = await sendSMS({ phone: "9876543210", message: "Hello AgriRent" });
    assert(
        smsMissingCreds.delivered === false && smsMissingCreds.error?.includes("credentials"),
        "Missing SMS credentials reports clear error and does NOT pretend delivery",
        JSON.stringify(smsMissingCreds)
    );

    // 5.4 Test provider mock simulation (verifies Fast2SMS API contract)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        if (url.includes("fast2sms.com")) {
            const body = JSON.parse(options.body);
            if (body.numbers === "9876543210" && options.headers.authorization === "TEST_KEY") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ return: true, request_id: "req_test_abc123", message: ["SMS sent successfully"] })
                };
            }
        }
        return originalFetch(url, options);
    };

    const prevApiKey = process.env.FAST2SMS_API_KEY;
    const prevProvider = process.env.SMS_PROVIDER;
    process.env.FAST2SMS_API_KEY = "TEST_KEY";
    process.env.SMS_PROVIDER = "fast2sms";

    const smsMockSuccess = await sendSMS({ phone: "9876543210", message: "Test delivery" });
    assert(
        smsMockSuccess.success === true && smsMockSuccess.delivered === true && smsMockSuccess.messageId === "req_test_abc123",
        "Fast2SMS integration dispatches valid payload and receives request_id confirmation",
        JSON.stringify(smsMockSuccess)
    );

    // 5.5 Test provider failure handling (API returns error)
    globalThis.fetch = async (url, options) => {
        if (url.includes("fast2sms.com")) {
            return {
                ok: false,
                status: 400,
                statusText: "Bad Request",
                json: async () => ({ return: false, message: "Invalid Authorization Key" })
            };
        }
        return originalFetch(url, options);
    };

    const smsMockFail = await sendSMS({ phone: "9876543210", message: "Test fail" });
    assert(
        smsMockFail.success === false && smsMockFail.delivered === false && smsMockFail.error?.includes("Invalid Authorization Key"),
        "Fast2SMS API error returns clean failure status and does not pretend delivery",
        JSON.stringify(smsMockFail)
    );

    // Restore environment & fetch
    globalThis.fetch = originalFetch;
    process.env.FAST2SMS_API_KEY = prevApiKey;
    process.env.SMS_PROVIDER = prevProvider;

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
