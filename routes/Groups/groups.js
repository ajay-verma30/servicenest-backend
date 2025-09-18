const express = require("express");
const route = express.Router();
const mysqlconnect = require("../../db/conn");
const promiseConn = mysqlconnect().promise();
const { nanoid } = require("nanoid");
const authToken = require("../../Auth/tokenAuthentication");

route.post("/new_group", authToken, async (req, res) => {
  try {
    const id = nanoid(8);
    const created_at = new Date();
    const { title, description, created_by, organization_id } = req.body;

    if (!title || !description || !created_by || !organization_id) {
      return res.status(400).json({
        success: false,
        message:
          "All fields (title, description, created_by, organization_id) are required.",
      });
    }

    const insertQuery = `
            INSERT INTO user_groups (id, title, description, created_by, organization_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
    const [results] = await promiseConn.query(insertQuery, [
      id,
      title,
      description,
      created_by,
      organization_id,
      created_at,
    ]);

    if (results.affectedRows !== 1) {
      return res.status(500).json({
        success: false,
        message: "Failed to create the group. Please try again later.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Group created successfully.",
      data: {
        id,
        title,
        description,
        created_by,
        organization_id,
        created_at,
      },
    });
  } catch (err) {
    console.error("Error creating group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

route.get("/all/:id", authToken, async (req, res) => {
  try {
    const { id } = req.params;
    const getAllQuery = `SELECT 
    g.id,
    g.title,
    g.description,
    g.created_at,
    CONCAT(u.f_name,' ', u.l_name) as created_by
FROM user_groups g
JOIN users u ON g.created_by = u.id
WHERE g.organization_id = ?`;
    const [results] = await promiseConn.query(getAllQuery, [id]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No groups found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (err) {
    console.error("Error fetching groups:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

route.get("/:orgId/:groupId", authToken, async (req, res) => {
  try {
    const { orgId, groupId } = req.params;

    const getQuery = `
            SELECT 
                g.id,
                g.title,
                g.description,
                g.created_at,
                CONCAT(u.f_name, ' ', u.l_name) AS created_by
            FROM user_groups g
            JOIN users u ON g.created_by = u.id
            WHERE g.id = ? AND g.organization_id = ?
        `;

    const [results] = await promiseConn.query(getQuery, [groupId, orgId]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No group found with id '${groupId}' under organization '${orgId}'.`,
      });
    }

    return res.status(200).json({
      success: true,
      data: results[0],
    });
  } catch (err) {
    console.error("Error fetching group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

route.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deleteQuery = "DELETE FROM user_groups WHERE id = ?";
    const [result] = await promiseConn.query(deleteQuery, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: `No group found with id '${id}'.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Group deleted successfully.",
    });
  } catch (err) {
    console.error("Error deleting group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

module.exports = route;
