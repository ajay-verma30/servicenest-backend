const express = require('express')
const route = express.Router();
const mysqlconnect = require('../../db/conn')
const {body, validationResult} = require('express-validator');
const promiseConn = mysqlconnect().promise();
const { nanoid } = require('nanoid')
const authToken = require('../../Auth/tokenAuthentication')

const commentValidation = [
    body('ticket_id')
    .exists().withMessage('ticket_id is required')
    .isString().withMessage('ticket_id must be a string')
    .isLength({ max: 20 }).withMessage('ticket_id max length is 20'),
    
    body('user_id')
    .exists().withMessage('user_id is required')
    .isString().withMessage('user_id must be a string')
    .isLength({ max: 20 }).withMessage('user_id max length is 20'),

    body('message')
    .isString().withMessage('Message is Required'),

    body('is_internal')
    .optional()
    .isBoolean().withMessage('is_internal must be a boolean')
    .toBoolean()
]

route.post('/new', authToken, commentValidation, async (req, res) => {
  try {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const comment_id = nanoid(10); 
    const created_at = new Date();

    const { ticket_id, user_id, message, is_internal } = req.body;

    const createCommentQuery = `
      INSERT INTO comments
      (id, ticket_id, user_id, message, is_internal, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const [result] = await promiseConn.query(createCommentQuery, [
      comment_id,
      ticket_id,
      user_id,
      message,
      is_internal,
      created_at
    ]);

    if (result.affectedRows !== 1) {
      return res.status(500).json({
        success: false,
        message: 'Failed to add comment'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: { id: comment_id }
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});


module.exports = route