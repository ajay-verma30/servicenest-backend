const express = require("express");
const route = express.Router();
const mysqlconnect = require("../../db/conn");
const promiseConn = mysqlconnect().promise();
const { nanoid } = require("nanoid");
const authToken = require("../../Auth/tokenAuthentication");


route.post("/new", authToken, async (req, res) => {
  try {
    const id = nanoid(9);
    const created_at = new Date();
    const { title, description = null, created_by, organization_id } = req.body;

    if (!title?.trim() || !created_by || !organization_id) {
      return res.status(400).json({ message: "Please fill all the details" });
    }

    const insertRoleQuery = `
      INSERT INTO roles (id, title, description, organization_id, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [results] = await promiseConn.query(insertRoleQuery, [
      id,
      title.trim(),
      description,
      organization_id,
      created_at,
      created_by,
    ]);

    if (results.affectedRows !== 1) {
      return res
        .status(400)
        .json({ message: "Unable to create role at this moment" });
    }

    return res.status(201).json({
      success: true,
      message: "Role created successfully"
    });
  } catch (err) {
    console.error("Error creating role:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: `Role with title '${req.body.title}' already exists for this organization.`,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});


route.post("/assign", authToken,async (req, res) => {
  try {
    const { user_id, role_id } = req.body;

    if (!user_id || !role_id) {
      return res.status(400).json({ message: "user_id and role_id are required" });
    }

    const insertQuery = `
      INSERT INTO user_roles (user_id, roles_id)
      VALUES (?, ?)
    `;

    await promiseConn.query(insertQuery, [user_id, role_id]);

    return res.status(201).json({
      success: true
    });
  } catch (err) {
    console.error("Error assigning role:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This user already has that role assigned.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});




route.get("/all/:id", authToken,async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "organization_id is required" });
    }
    const [rows] = await promiseConn.query(
      `SELECT 
	r.title, 
    r.description, 
    r.id, 
    r.created_at, 
    CONCAT(u.f_name,' ',u.l_name) as full_name
    FROM roles r
    JOIN users u ON r.created_by= u.id
    WHERE organization_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "No roles found for this organization" });
    }
    return res.status(200).json({ roles: rows });
  } catch (err) {
    console.error("Error fetching role:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});



route.get("/:orgId/:roleId", authToken, async (req, res) => {
  try {
    const { orgId, roleId } = req.params;

    const getQuery = `
      SELECT 
          r.id,
          r.title,
          r.description,
          r.created_at,
          CONCAT(u.f_name, ' ', u.l_name) AS created_by
      FROM roles r
      JOIN users u ON r.created_by = u.id
      WHERE r.id = ? AND r.organization_id = ?
    `;
    const [results] = await promiseConn.query(getQuery, [roleId, orgId]);
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No role found with id '${roleId}' under organization '${orgId}'.`,
      });
    }
    return res.status(200).json({
      success: true,
      data: results[0],
    });
  } catch (err) {
    console.error("Error fetching role:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});




route.delete("/:id",authToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [results] = await promiseConn.query("DELETE FROM roles WHERE id = ?", [
      id,
    ]);

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.status(200).json({ message: "Role deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = route;
