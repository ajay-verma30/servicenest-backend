const express = require('express')
const route = express.Router()
const { nanoid } = require('nanoid')
const {body, validationResult} = require('express-validator');
const mysqlconnect = require('../../db/conn')
const promiseConn = mysqlconnect().promise();
const authToken =  require('../../Auth/tokenAuthentication')

const ticketValidationRules = [
  body('title')
    .exists().withMessage('title is required')
    .isString().withMessage('title must be a string')
    .isLength({ max: 200 }).withMessage('title max length is 200'),
  
  body('description')
    .optional()
    .isString().withMessage('description must be a string'),

  body('status')
    .optional()
    .isIn(['open', 'in_progress', 'resolved', 'closed', 'rejected']).withMessage('invalid status'),

  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent']).withMessage('invalid priority'),

  body('type')
    .optional()
    .isIn(['bug', 'feature_request', 'support']).withMessage('invalid type'),

  body('created_by')
    .exists().withMessage('created_by is required')
    .isString().withMessage('created_by must be a string')
    .isLength({ max: 20 }).withMessage('created_by max length is 20'),

  body('assignee_id')
    .optional()
    .isString().withMessage('assignee_id must be a string')
    .isLength({ min: 36, max: 36 }).withMessage('assignee_id must be 36 characters'),

  body('organization_id')
    .optional()
    .isString().withMessage('organization_id must be a string')
    .isLength({ min: 36, max: 36 }).withMessage('organization_id must be 36 characters'),

  body('assigned_team')
    .optional()
    .isString().withMessage('assigned_team must be a string')
    .isLength({ max: 50 }).withMessage('assigned_team max length is 50')
];


route.post('/new', ticketValidationRules, authToken, async(req,res)=>{
    try{
        const errors = validationResult(req);
        if(!errors.isEmpty){
            return res.status(400).json({ success: false, message:"Validation Failed", errors: errors.array() });
        }
        const ticket_id = nanoid(6);
        const created_at = new Date();
        
        const {
            title,
            description,
            priority,
            type,
            created_by
        } = req.body

        if(!title){
            return res.status(402).json({message:"Title is mandatory"});
        }
        const addTicket = "INSERT INTO tickets(id, title, description,priority, type, created_by,created_at)VALUES(?,?,?,?,?,?,?)";
        const [results] = await promiseConn.query(addTicket,[ticket_id,title, description, priority, type, created_by, created_at]);
        if(results.affectedRows !== 1){
            return res.status(500).json({message:"Failed to Create ticket"});
        }
            return res.status(201).json({message:"Ticket Added to the database"});
     
    }
    catch (error) {
    console.error('Error creating ticket:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
})

route.get('/all', authToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const { search, status, priority, type, assignee } = req.query;

    let baseQuery = `
      SELECT *
      FROM tickets
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      baseQuery += " AND status = ?";
      params.push(status);
    }

    if (priority) {
      baseQuery += " AND priority = ?";
      params.push(priority);
    }

    if (type) {
      baseQuery += " AND type = ?";
      params.push(type);
    }

    if (assignee) {
      baseQuery += " AND assignee_id = ?";
      params.push(assignee);
    }
    if (search) {
      baseQuery += " AND (title LIKE ? OR description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    baseQuery += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const [tickets] = await promiseConn.query(baseQuery, params);

    return res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

route.get('/:id', authToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [tickets] = await promiseConn.query(
      `SELECT 
    t.*,
    CONCAT(cb.f_name, ' ', cb.l_name) AS created_by_name,
    cb.email AS created_by_email,
    CONCAT(asg.f_name, ' ', asg.l_name) AS assignee_name,
    asg.email AS assignee_email,
    tm.title AS team_title
FROM tickets t
JOIN users cb ON t.created_by = cb.id
LEFT JOIN users asg ON t.assignee_id = asg.id
LEFT JOIN teams tm ON t.assigned_team = tm.id
WHERE t.id = ?;`,
      [id]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No ticket found with this id'
      });
    }

    const ticket = tickets[0];

    const [comments] = await promiseConn.query(
      `SELECT 
    c.id,
    c.ticket_id,
    c.user_id,
    c.message,
    c.is_internal,
    c.created_at,
    CONCAT(u.f_name, ' ', u.l_name) AS commented_by,
    u.email AS commenter_email
FROM comments c
JOIN users u ON c.user_id = u.id
WHERE c.ticket_id = ?
ORDER BY c.created_at DESC;`,
      [id]
    );


    return res.status(200).json({
      success: true,
      data: {
        ...ticket,
        comments
      }
    });
  } catch (error) {
    console.error('Error fetching ticket with comments:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});



route.get('/:orgId/teams', authToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const [teams] = await promiseConn.query(
      `SELECT id, title FROM teams WHERE organization_id = ?`,
      [orgId]
    );
    return res.json({ success: true, data: teams });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

route.get('/:orgId/teams/:teamId/users', authToken, async (req, res) => {
  try {
    const { orgId, teamId } = req.params;
    const [users] = await promiseConn.query(
      `SELECT id, CONCAT(f_name, ' ', l_name) AS name, email 
       FROM users 
       WHERE organization = ? AND team = ?`,
      [orgId, teamId]
    );
    return res.json({ success: true, data: users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});




route.patch('/:id', authToken, async (req, res) => {
  const conn = promiseConn;
  try {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user?.id || null; 

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update provided." });
    }

    const allowedUpdates = ['assignee_id', 'assigned_team', 'priority', 'status', 'type'];
    const fieldsToUpdate = {};


    const [currentRows] = await conn.query(`SELECT * FROM tickets WHERE id = ?`, [id]);
    if (currentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const currentTicket = currentRows[0];

    for (const key in updates) {
      if (allowedUpdates.includes(key) && updates[key] != null) {
        fieldsToUpdate[key] = updates[key];
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ message: "No valid fields to update provided." });
    }

    fieldsToUpdate.updated_at = new Date();
    const setClause = Object.keys(fieldsToUpdate).map(field => `${field} = ?`).join(', ');
    const values = Object.values(fieldsToUpdate);
    values.push(id);


    const updateTicketQuery = `UPDATE tickets SET ${setClause} WHERE id = ?`;
    const [result] = await conn.query(updateTicketQuery, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not updated' });
    }

    const historyInserts = [];
    for (const key in fieldsToUpdate) {
      if (key === "updated_at") continue; 

      const oldValue = currentTicket[key];
      const newValue = fieldsToUpdate[key];

      if (oldValue != newValue) {
        historyInserts.push([
          id,                
          key,               
          oldValue || null,  
          newValue || null,  
          userId,            
          new Date()         
        ]);
      }
    }

    if (historyInserts.length > 0) {
      const insertQuery = `
        INSERT INTO updates (ticket_id, field_name, old_value, new_value, updated_by, created_at)
        VALUES ?`;
      await conn.query(insertQuery, [historyInserts]);
    }

    return res.json({
      success: true,
      message: 'Ticket updated successfully'
    });

  } catch (error) {
    console.error('Error updating the ticket:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});


route.get('/:id/updates', authToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT u.id, u.ticket_id, u.field_name, u.old_value, u.new_value, 
             u.created_at, u.updated_by, 
             CONCAT(users.f_name, ' ', users.l_name) as updated_by_name
      FROM updates u
      LEFT JOIN users ON u.updated_by = users.id
      WHERE u.ticket_id = ?
      ORDER BY u.created_at DESC
    `;
    const [rows] = await promiseConn.query(query, [id]);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching updates:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});






//API's for dashboard 

route.get('/:orgId/dashboard/overview', authToken, async (req, res) => {
  try {
    const { orgId } = req.params;

    // 1. Tickets by status
    const [statusStats] = await promiseConn.query(
      `SELECT status, COUNT(*) as count
       FROM tickets
       WHERE organization_id = ?
       GROUP BY status`,
      [orgId]
    );

    // 2. Tickets by priority
    const [priorityStats] = await promiseConn.query(
      `SELECT priority, COUNT(*) as count
       FROM tickets
       WHERE organization_id = ?
       GROUP BY priority`,
      [orgId]
    );

    // 3. Tickets created per day (last 30 days)
    const [dailyStats] = await promiseConn.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM tickets
       WHERE organization_id = ?
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`,
      [orgId]
    );

    // 4. Tickets per team
    const [teamStats] = await promiseConn.query(
      `SELECT tm.title as team, COUNT(t.id) as count
       FROM tickets t
       LEFT JOIN teams tm ON t.assigned_team = tm.id
       WHERE t.organization_id = ?
       GROUP BY tm.title`,
      [orgId]
    );

   

    const [lastTenTickets] = await promiseConn.query(
  `SELECT id, title, status, priority, created_at
   FROM tickets
   WHERE organization_id = ?
   ORDER BY created_at DESC
   LIMIT 10`,
  [orgId] 
);
    return res.json({
      success: true,
      data: {
        status: statusStats,
        priority: priorityStats,
        daily: dailyStats,
        teams: teamStats,
        recent: lastTenTickets
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});



module.exports = route
