const express = require("express");
const route = express.Router();
const { nanoid } = require("nanoid");
const mysqlconnect = require("../../db/conn");
const promiseConn = mysqlconnect().promise();
const authToken = require("../../Auth/tokenAuthentication");
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

route.post('/new', authToken, upload.single('attachment'), async (req, res) => {
    try {
        const { title, description, priority, type, created_by, organization_id } = req.body;
        const ticket_id = nanoid(6);
        const created_at = new Date();

        const addTicketQuery = `
            INSERT INTO tickets(id, title, description, priority, type, created_by, created_at, organization_id)
            VALUES(?,?,?,?,?,?,?,?)`;
        const [results] = await promiseConn.query(addTicketQuery, [
            ticket_id,
            title,
            description || null,
            priority || 'medium',
            type || 'support',
            created_by,
            created_at,
            organization_id
        ]);

        if (results.affectedRows !== 1) 
            return res.status(500).json({ message: "Failed to create ticket" });
        
        if (req.file) {
            const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

            await promiseConn.query(
                `INSERT INTO attachments(ticket_id, file_url, uploaded_by) VALUES(?, ?, ?)`,
                [ticket_id, fileUrl, created_by]
            );
        }

        return res.status(201).json({ message: "Ticket added to database" });
    } catch (error) {
        console.error("Error creating ticket:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
});

route.get("/:orgId/all", authToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const { search, status, priority, type, assignee } = req.query;

    let baseQuery = `
      SELECT 
        t.id, 
        t.title, 
        t.description, 
        t.status, 
        t.priority, 
        t.assignee_id, 
        t.assigned_team, 
        t.created_at, 
        t.updated_at, 
        CONCAT(u.f_name,' ',u.l_name) as created_by,
        CONCAT(a.f_name, ' ', a.l_name) AS assignee_name
      FROM tickets t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN users a ON t.assignee_id = a.id 
      WHERE t.organization_id = ? 
    `;

    const params = [orgId];

    if (status) {
      baseQuery += " AND t.status = ?";
      params.push(status);
    }

    if (priority) {
      baseQuery += " AND t.priority = ?";
      params.push(priority);
    }

    if (type) {
      baseQuery += " AND t.type = ?";
      params.push(type);
    }

    if (assignee) {
      baseQuery += " AND t.assignee_id = ?";
      params.push(assignee);
    }

    if (search) {
      baseQuery += " AND (t.title LIKE ? OR t.description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    baseQuery += " ORDER BY t.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const [tickets] = await promiseConn.query(baseQuery, params);

    return res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

route.get("/:id", authToken, async (req, res) => {
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
      return res.status(404).json({ success: false, message: "No ticket found" });
    }
    const ticket = tickets[0];

    const [ticketAttachments] = await promiseConn.query(
      `SELECT * FROM attachments WHERE ticket_id = ?`,
      [id]
    );

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

    const commentIds = comments.map(c => c.id);
    let attachmentsMap = {};
    if (commentIds.length > 0) {
      const [commentAttachments] = await promiseConn.query(
        `SELECT * FROM attachments WHERE comment_id IN (?)`,
        [commentIds]
      );
      commentAttachments.forEach(att => {
        if (!attachmentsMap[att.comment_id]) attachmentsMap[att.comment_id] = [];
        attachmentsMap[att.comment_id].push(att);
      });
    }

    const commentsWithAttachments = comments.map(comment => ({
      ...comment,
      attachments: attachmentsMap[comment.id] || []
    }));

    return res.status(200).json({
      success: true,
      data: {
        ...ticket,
        attachments: ticketAttachments,       
        comments: commentsWithAttachments,    
      },
    });
  } catch (error) {
    console.error("Error fetching ticket with comments and attachments:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

route.get("/:orgId/teams", authToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const [teams] = await promiseConn.query(
      `SELECT id, title FROM teams WHERE organization_id = ?`,
      [orgId]
    );
    return res.json({ success: true, data: teams });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

route.get("/:orgId/teams/:teamId/users", authToken, async (req, res) => {
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
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

route.patch("/:id", authToken, async (req, res) => {
  const conn = promiseConn;
  try {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user?.id || req.user?.userId || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update provided." });
    }

    const allowedUpdates = [
      "assignee_id",
      "assigned_team",
      "priority",
      "status",
      "type",
    ];
    const fieldsToUpdate = {};

    const [currentRows] = await conn.query(
      `SELECT * FROM tickets WHERE id = ?`,
      [id]
    );
    if (currentRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }
    const currentTicket = currentRows[0];

    for (const key in updates) {
      if (allowedUpdates.includes(key) && updates[key] != null) {
        fieldsToUpdate[key] = updates[key];
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res
        .status(400)
        .json({ message: "No valid fields to update provided." });
    }

    fieldsToUpdate.updated_at = new Date();
    const setClause = Object.keys(fieldsToUpdate)
      .map((field) => `${field} = ?`)
      .join(", ");
    const values = Object.values(fieldsToUpdate);
    values.push(id);

    const updateTicketQuery = `UPDATE tickets SET ${setClause} WHERE id = ?`;
    const [result] = await conn.query(updateTicketQuery, values);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not updated" });
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
          new Date(),
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
      message: "Ticket updated successfully",
    });
  } catch (error) {
    console.error("Error updating the ticket:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

route.get("/:id/updates", authToken, async (req, res) => {
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
    console.error("Error fetching updates:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

route.get("/:orgId/dashboard/overview", authToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const range = parseInt(req.query.range, 10) || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - range);
    const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");

    const [statusStats] = await promiseConn.query(
      `SELECT status, COUNT(*) as count
       FROM tickets
       WHERE organization_id = ? AND created_at >= ?
       GROUP BY status`,
      [orgId, startDateStr]
    );

    const [priorityStats] = await promiseConn.query(
      `SELECT priority, COUNT(*) as count
       FROM tickets
       WHERE organization_id = ? AND created_at >= ?
       GROUP BY priority`,
      [orgId, startDateStr]
    );

    const [dailyStats] = await promiseConn.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM tickets
       WHERE organization_id = ? AND created_at >= ?
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT ${range}`,
      [orgId, startDateStr]
    );

    const [teamStats] = await promiseConn.query(
      `SELECT tm.title as team, COUNT(t.id) as count
       FROM tickets t
       LEFT JOIN teams tm ON t.assigned_team = tm.id
       WHERE t.organization_id = ? AND t.created_at >= ?
       GROUP BY tm.title`,
      [orgId, startDateStr]
    );

    const [lastTenTickets] = await promiseConn.query(
      `SELECT id, title, status, priority, created_at
       FROM tickets
       WHERE organization_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [orgId, startDateStr]
    );

    const [totalStats] = await promiseConn.query(
      `SELECT 
         COUNT(*) as totalTickets,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openTickets,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolvedTickets
       FROM tickets
       WHERE organization_id = ? AND created_at >= ?`,
      [orgId, startDateStr]
    );

    return res.json({
      success: true,
      data: {
        totalTickets: totalStats[0]?.totalTickets || 0,
        openTickets: totalStats[0]?.openTickets || 0,
        resolvedTickets: totalStats[0]?.resolvedTickets || 0,
        status: statusStats,
        priority: priorityStats,
        daily: dailyStats,
        teams: teamStats,
        recent: lastTenTickets,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard overview:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

route.get('/:id/my', authToken, async (req, res) => {
  try {
    const { id } = req.params;

    const myTicketsQuery = `
      SELECT  
        CONCAT(cb.f_name, ' ', cb.l_name) AS created_by,
        t.title,
        t.id,
        t.status,
        t.priority,
        t.assigned_team,
        t.created_at,
        t.updated_at
      FROM tickets t
      JOIN users cb ON t.created_by = cb.id
      WHERE t.assignee_id = ?
      ORDER BY t.created_at DESC
    `;

    const [results] = await promiseConn.query(myTicketsQuery, [id]);

    if (results.length === 0) {
      return res.status(404).json({ message: "No tickets assigned to you yet!" });
    }

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("Error fetching assigned tickets:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = route;