import multer from "multer";

const storage = multer.memoryStorage();

// Allowed MIME types for media (images and videos only)
const mediaMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
    "video/mp4",
    "video/webm"
];

// Allowed MIME types for evidence and documentation (images, videos, and PDFs)
const documentMimeTypes = [
    ...mediaMimeTypes,
    "application/pdf"
];

const mediaFileFilter = (req, file, cb) => {
    if (mediaMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPG, JPEG, PNG, WEBP, MP4, and WEBM media files are allowed"), false);
    }
};

const documentFileFilter = (req, file, cb) => {
    if (documentMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPG, JPEG, PNG, WEBP, MP4, WEBM, and PDF files are allowed"), false);
    }
};

export const uploadMedia = multer({
    storage,
    fileFilter: mediaFileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

export const uploadDocument = multer({
    storage,
    fileFilter: documentFileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

// Default export uses media filter (image/video only) for equipment and inspection media
export default uploadMedia;
