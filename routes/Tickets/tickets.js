const express = require("express");
const route = express.Router();
const { nanoid } = require("nanoid");
const mysqlconnect = require("../../db/conn");
const promiseConn = mysqlconnect().promise();
const authToken = require("../../Auth/tokenAuthentication");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

//creating new ticket
route.post("/new", authToken, upload.single("attachment"), async (req, res) => {
  try {
    const { title, description, priority, type, created_by, organization_id } =
      req.body;

    if (!title || !created_by || !organization_id) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const ticket_id = nanoid(6);
    const created_at = new Date();

    const addTicketQuery = `
      INSERT INTO tickets(id, title, description, priority, type, created_by, created_at, organization_id)
      VALUES(?,?,?,?,?,?,?,?)
    `;
    const [results] = await promiseConn.query(addTicketQuery, [
      ticket_id,
      title,
      description || null,
      priority || "medium",
      type || "support",
      created_by,
      created_at,
      organization_id,
    ]);

    if (results.affectedRows !== 1) {
      return res
        .status(500)
        .json({ success: false, message: "Failed to create ticket" });
    }

    if (req.file) {
      const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${
        req.file.filename
      }`;
      await promiseConn.query(
        `INSERT INTO attachments(ticket_id, file_url, uploaded_by) VALUES(?, ?, ?)`,
        [ticket_id, fileUrl, created_by]
      );
    }

    return res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      ticket_id,
    });
  } catch (error) {
    console.error("Error creating ticket:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//adding users to watchers list
route.post("/:id/watchers", authToken, async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  try {
    const watchersInsertQuery =
      "INSERT INTO ticket_watchers(ticket_id, user_id)VALUES(?,?)";
    const [results] = await promiseConn.query(watchersInsertQuery, [
      id,
      user_id,
    ]);
    if (results.affectedRows !== 1) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Unable to update the watchers list. Try again!",
        });
    }
    return res
      .status(201)
      .json({ success: true, message: "Updated watchers list" });
  } catch (error) {
    console.error("Error updating watchers:", error); // Specific error log
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//merging tickets
route.post("/merge", authToken, async (req, res) => {
  const { master_ticket_id, merged_ticket_ids, merged_by } = req.body;

  if (!master_ticket_id || !merged_ticket_ids?.length || !merged_by) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  const connection = await promiseConn.getConnection();
  try {
    await connection.beginTransaction();

    const mergeQuery =
      "INSERT INTO ticket_merges(master_ticket_id, merged_ticket_id, merged_by) VALUES (?, ?, ?)";
    for (const merged_ticket_id of merged_ticket_ids) {
      const [result] = await connection.query(mergeQuery, [
        master_ticket_id,
        merged_ticket_id,
        merged_by,
      ]);
      if (result.affectedRows !== 1) {
        await connection.rollback();
        return res
          .status(400)
          .json({ success: false, message: `Failed to merge ticket ${merged_ticket_id}` });
      }
    }
    await connection.commit();
    return res
      .status(201)
      .json({ success: true, message: "Tickets merged successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("Error merging tickets:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  } finally {
    connection.release();
  }
});

route.get("/:orgId/search", authToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ success: false, message: "Search query 'q' is required" });
    }

    const searchQuery = `
      SELECT * FROM tickets
      WHERE organization_id = ? AND (id LIKE ? OR title LIKE ? OR description LIKE ?)
    `;
    const [results] = await promiseConn.query(searchQuery, [
      orgId,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`
    ]);
    return res.json({ success: true, data: results });
  } catch (error) {
    console.error("Error searching tickets:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

//getting all tickets of organization
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
        t.type,
        t.assignee_id, 
        t.assigned_team, 
        t.created_at, 
        t.updated_at, 
        CONCAT(u.f_name,' ',u.l_name) as created_by_name,
        CONCAT(a.f_name, ' ', a.l_name) AS assignee_name,
        tm.title AS team_name
      FROM tickets t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN users a ON t.assignee_id = a.id 
      LEFT JOIN teams tm ON t.assigned_team = tm.id
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

//specific ticket details
route.get("/:id", authToken, async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get ticket details
    const [tickets] = await promiseConn.query(
      `SELECT 
        t.*,
        CONCAT(cb.f_name, ' ', cb.l_name) AS created_by_name,
        cb.email AS created_by_email,
        CONCAT(asg.f_name, ' ', asg.l_name) AS assignee_name,
        asg.email AS assignee_email,
        tm.title AS team_title
      FROM tickets t
      LEFT JOIN users cb ON t.created_by = cb.id
      LEFT JOIN users asg ON t.assignee_id = asg.id
      LEFT JOIN teams tm ON t.assigned_team = tm.id
      WHERE t.id = ?;`,
      [id]
    );

    if (tickets.length === 0) {
      return res.status(404).json({ success: false, message: "No ticket found" });
    }
    const ticket = tickets[0];

    // 2. Check if this ticket was merged into another
    const [mergeCheck] = await promiseConn.query(
      `SELECT master_ticket_id 
        FROM ticket_merges 
        WHERE merged_ticket_id = ? 
        LIMIT 1;`,
      [id]
    );

    let isMerged = false;
    let masterTicketId = null;

    if (mergeCheck.length > 0) {
      isMerged = true;
      masterTicketId = mergeCheck[0].master_ticket_id;
    }

    // 3. If this is a master ticket, fetch merged tickets
    let mergedTickets = [];
    if (!isMerged) {
      const [mergedRows] = await promiseConn.query(
        `SELECT 
          t.id, t.title, t.status, t.priority 
          FROM ticket_merges tm
          JOIN tickets t ON tm.merged_ticket_id = t.id
          WHERE tm.master_ticket_id = ?;`,
        [id]
      );
      mergedTickets = mergedRows;
    }

    // 4. Fetch ticket attachments
    const [ticketAttachments] = await promiseConn.query(
      `SELECT * FROM attachments WHERE ticket_id = ?`,
      [id]
    );

    // 5. Fetch comments
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

    // 6. Attachments for comments
    const commentIds = comments.map((c) => c.id);
    let attachmentsMap = {};
    if (commentIds.length > 0) {
      const [commentAttachments] = await promiseConn.query(
        `SELECT * FROM attachments WHERE comment_id IN (?)`,
        [commentIds]
      );
      commentAttachments.forEach((att) => {
        if (!attachmentsMap[att.comment_id]) attachmentsMap[att.comment_id] = [];
        attachmentsMap[att.comment_id].push(att);
      });
    }

    const commentsWithAttachments = comments.map((comment) => ({
      ...comment,
      attachments: attachmentsMap[comment.id] || [],
    }));

    // 7. Final response
    return res.status(200).json({
      success: true,
      data: {
        ...ticket,
        attachments: ticketAttachments,
        comments: commentsWithAttachments,
        is_merged: isMerged,
        master_ticket_id: masterTicketId,
        merged_tickets: mergedTickets,
        editable: !isMerged,
      },
    });
  } catch (error) {
    console.error("Error fetching ticket details:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

//getting watchers list of the ticket
route.get("/:id/watchers", authToken, async (req, res) => {
  const { id } = req.params;
  try {
    const getWatchers = `
      SELECT t.ticket_id, CONCAT(u.f_name, " ", u.l_name) AS watcher, u.id as user_id
      FROM ticket_watchers t 
      JOIN users u ON t.user_id = u.id
      WHERE t.ticket_id = ?;
    `;
    const [results] = await promiseConn.query(getWatchers, [id]);
    if (results.length === 0) {
      return res.status(404).json({ message: "No watchers yet" }); // Changed to 404
    }
    return res.status(200).json({ success: true, data: results }); // Added success and data keys
  } catch (error) {
    console.error("Error fetching watchers:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

//get specific organization team
route.get("/:orgId/teams", authToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const [teams] = await promiseConn.query(
      `SELECT id, title FROM teams WHERE organization_id = ?`,
      [orgId]
    );
    return res.json({ success: true, data: teams });
  } catch (err) {
    console.error("Error fetching teams:", err);
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
    console.error("Error fetching team users:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//updating ticket details
route.patch("/:id", authToken, async (req, res) => {
  const conn = promiseConn;
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

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

    const [currentRows] = await connection.query(
      `SELECT * FROM tickets WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (currentRows.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }
    const currentTicket = currentRows[0];

    for (const key in updates) {
      if (
        allowedUpdates.includes(key) &&
        updates[key] !== undefined &&
        updates[key] !== null
      ) {
        fieldsToUpdate[key] = updates[key];
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      await connection.rollback();
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
    const [result] = await connection.query(updateTicketQuery, values);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Ticket not updated" });
    }

    const historyInserts = [];
    for (const key in fieldsToUpdate) {
      if (key === "updated_at") continue;

      const oldValue = currentTicket[key];
      const newValue = fieldsToUpdate[key];

      if (String(oldValue) !== String(newValue)) {
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
      await connection.query(insertQuery, [historyInserts]);
    }

    await connection.commit();

    return res.json({
      success: true,
      message: "Ticket updated successfully",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error updating the ticket:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    connection.release();
  }
});

//getting updates history of tickets
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

//get dashboard overview of the organization
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
        LIMIT ?`, // Use prepared statement for LIMIT
      [orgId, startDateStr, range]
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

//getting my ticket details
route.get("/my", authToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

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

    const [results] = await promiseConn.query(myTicketsQuery, [userId]);

    if (results.length === 0) {
      return res
        .status(200)
        .json({ success: true, count: 0, data: [], message: "No tickets assigned to you yet!" }); // Changed to 200 for a successful but empty result
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

route.delete("/:id/watchers/:user_id", authToken, async (req, res) => {
  const { id, user_id } = req.params;
  try {
    const removerWatcher =
      "DELETE FROM ticket_watchers WHERE ticket_id = ? AND user_id = ?"; // Corrected 'DELECT' to 'DELETE'
    const [results] = await promiseConn.query(removerWatcher, [id, user_id]);
    if (results.affectedRows !== 1) {
      return res
        .status(400)
        .json({ message: "Unable to remove the user. Try Again!" });
    }
    return res
      .status(200)
      .json({ message: "User removed from the watch list" });
  } catch (err) {
    console.error("Error removing watcher:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = route;