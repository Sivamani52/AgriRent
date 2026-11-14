import express from "express";

import {
    createBooking,
    getBookingById,
    getAllBookings,
    getFarmerBookings,
    getOwnerBookings,
    acceptBooking,
    rejectBooking,
    cancelBooking
} from "../controllers/bookingController.js";
import { authenticateUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post(
    "/bookings",
    authenticateUser,
    authorizeRoles("FARMER", "AREA_ADMIN"),
    createBooking
);

router.get(
    "/bookings",
    authenticateUser,
    authorizeRoles("AREA_ADMIN", "SUPER_ADMIN"),
    getAllBookings
);

router.patch(
    "/bookings/:bookingId/accept",
    authenticateUser,
    authorizeRoles("OWNER"),
    acceptBooking
);

router.patch(
    "/bookings/:bookingId/reject",
    authenticateUser,
    authorizeRoles("OWNER"),
    rejectBooking
);

router.patch(
    "/bookings/:bookingId/cancel",
    authenticateUser,
    authorizeRoles("FARMER", "AREA_ADMIN", "SUPER_ADMIN"),
    cancelBooking
);

router.get(
    "/bookings/:bookingId",
    authenticateUser,
    getBookingById
);

router.get(
    "/bookings/farmer/:farmerId",
    authenticateUser,
    authorizeRoles("FARMER", "AREA_ADMIN", "SUPER_ADMIN"),
    getFarmerBookings
);

router.get(
    "/bookings/owner/:ownerId",
    authenticateUser,
    authorizeRoles("OWNER", "AREA_ADMIN", "SUPER_ADMIN"),
    getOwnerBookings
);

export default router;