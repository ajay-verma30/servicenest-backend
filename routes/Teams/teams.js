const express = require("express");
const route = express.Router();
const mysqlconnect = require("../../db/conn");
const promiseConn = mysqlconnect().promise();
const { nanoid } = require("nanoid");

route.post("/new", async (req, res) => {
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

route.get("/:orgId/all", async (req, res) => {
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
module.exports = route;
