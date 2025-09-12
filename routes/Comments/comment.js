const express = require('express');
const route = express.Router();
const mysqlconnect = require('../../db/conn');
const promiseConn = mysqlconnect().promise();
const { nanoid } = require('nanoid');
const authToken = require('../../Auth/tokenAuthentication');
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, '../../uploads'); 
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ storage })


route.post("/new", upload.single("attachment"), async (req, res) => {
  try {
    const { ticket_id, user_id, message, is_internal } = req.body;
    const isInternalValue =
      is_internal === true || is_internal === "true" ? 1 : 0;

    const comment_id = nanoid(10);
    const created_at = new Date();

    const createCommentQuery = `
      INSERT INTO comments (id, ticket_id, user_id, message, is_internal, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;


    await promiseConn.query(createCommentQuery, [
      comment_id,
      ticket_id,
      user_id,
      message,
      isInternalValue,
      created_at,
    ]);

    if (req.file) {
       const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      const insertAttachmentQuery = `
        INSERT INTO attachments (ticket_id, comment_id, file_url, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `;
      await promiseConn.query(insertAttachmentQuery, [
        ticket_id,
        comment_id,
        fileUrl,
        user_id,
        created_at,
      ]);


      const autoCommentId = nanoid(10);
      const autoMessage = `Attachment added "${req.file.originalname}"`;

      await promiseConn.query(createCommentQuery, [
        autoCommentId,
        ticket_id,
        user_id,
        autoMessage,
        isInternalValue,
        created_at,
      ]);
    }

    res.status(201).json({
      success: true,
      message: "Comment created successfully",
      comment_id,
    });
  } catch (err) {
    console.error("Error creating comment:", err);
    res.status(500).json({ success: false, message: "Error creating comment" });
  }
});

module.exports = route;
