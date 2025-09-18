const express = require("express");
const route = express.Router();
const mysqlconnect = require("../../db/conn");
const promiseConn = mysqlconnect().promise();
const { nanoid } = require("nanoid");
const authToken = require("../../Auth/tokenAuthentication");


route.post("/new", authToken ,async (req, res) => {
  try {
    const team_id = nanoid(4);
    const created_at = new Date();
    const { title, description, organization_id, created_by } = req.body;

    const insertQuery =
      "INSERT INTO teams(id,title, description, created_at, organization_id, created_by)VALUES(?,?,?,?,?,?)";
    const [result] = await promiseConn.query(insertQuery, [
      team_id,
      title,
      description,
      created_at,
      organization_id,
      created_by
    ]);
    if (result.affectedRows !== 1) {
      return res
        .status(400)
        .json({ message: "Unable to create the Team. Please try again later" });
    }
    return res.status(201).json({ message: "Team created" });
  } catch (e) {
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});

route.get("/:orgId/all", authToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const getTeams = `
       SELECT 
    t.id,
    t.title,
    t.created_by,
    CONCAT(u.f_name, ' ', u.l_name) AS created_by_name
FROM teams t
JOIN organizations o ON o.id = t.organization_id
LEFT JOIN users u ON u.id = t.created_by
WHERE o.id = ?;
`;
    const [result] = await promiseConn.query(getTeams, [orgId]);
    if (result.length === 0) {
      return res
        .status(404)
        .json({ message: "There are no Teams created at." });
    }
    return res.status(200).json({ result: result });
  } catch (e) {
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});


route.get('/:orgId/teams/:teamId/members', authToken, async (req, res) => {
  try {
    const { orgId, teamId } = req.params;

    const getAllTeamMembers = `
      SELECT 
        u.id,
        CONCAT(u.f_name, ' ', u.l_name) AS full_name,
        u.email
      FROM users u
      WHERE u.team = ?
      AND u.organization = ?;
    `;

    const [results] = await promiseConn.query(getAllTeamMembers, [teamId, orgId]);

    return res.status(200).json({
      success: true,
      members: results,
    });
  } catch (e) {
    console.error("Error fetching team members:", e);
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});

route.patch("/:orgId/teams/:teamId/removeMember/:userId", authToken, async (req, res) => {
  try {
    const { orgId, teamId, userId } = req.params;

    const checkUserQuery = `
      SELECT id FROM users 
      WHERE id = ? AND organization = ? AND team = ?;
    `;
    const [userCheck] = await promiseConn.query(checkUserQuery, [userId, orgId, teamId]);

    if (userCheck.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found in this team or organization." 
      });
    }

    const updateQuery = `UPDATE users SET team = NULL WHERE id = ? AND organization = ?;`;
    const [result] = await promiseConn.query(updateQuery, [userId, orgId]);

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Failed to remove user from the team.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User successfully removed from the team.",
    });
  } catch (e) {
    console.error("Error removing team member:", e);
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});


module.exports = route;
