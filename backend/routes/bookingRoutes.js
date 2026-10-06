import express from "express";

import {
    createBooking,
    getBookingById,
    getFarmerBookings,
    getOwnerBookings,
    acceptBooking,
    rejectBooking
} from "../controllers/bookingController.js";

const router = express.Router();

router.post(
    "/bookings",
    createBooking
);

router.patch(
    "/bookings/:bookingId/accept",
    acceptBooking
);

router.patch(
    "/bookings/:bookingId/reject",
    rejectBooking
);

router.get(
    "/bookings/:bookingId",
    getBookingById
);

router.get(
    "/bookings/farmer/:farmerId",
    getFarmerBookings
);

router.get(
    "/bookings/owner/:ownerId",
    getOwnerBookings
);

export default router;