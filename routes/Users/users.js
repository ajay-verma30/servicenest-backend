const express = require("express");
const { nanoid } = require("nanoid");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcryptjs");
const mysqlconnect = require("../../db/conn");
const promiseConn = mysqlconnect().promise();
const jwt = require("jsonwebtoken");
const route = express.Router();
const authToken = require("../../Auth/tokenAuthentication");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login Attempts. Please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const validateLogin = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Valid Email is Required"),
  body("password").isLength({ min: 1 }).withMessage("Password is Required"),
];

/**
 * Create User
 */
route.post("/new", async (req, res) => {
  try {
    const userId = nanoid(5);
    const created_at = new Date();
    const { f_name, l_name, email, password, contact, organization, roles } =
      req.body;
    const [existingUser] = await promiseConn.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existingUser.length > 0) {
      return res.status(409).json({ message: "Email already registered" });
    }
    const password_hash = await bcrypt.hash(password, 10);

    const insertUser = `
      INSERT INTO users(id, f_name, l_name, email, password_hash, contact, organization, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await promiseConn.query(insertUser, [
      userId,
      f_name,
      l_name,
      email,
      password_hash,
      contact,
      organization,
      created_at,
    ]);

    if (result.affectedRows !== 1) {
      return res
        .status(400)
        .json({ message: "Unable to create user. Please try again!" });
    }

    if (roles && Array.isArray(roles)) {
      for (const roleId of roles) {
        await promiseConn.query(
          "INSERT INTO user_roles (user_id, roles_id) VALUES (?, ?)",
          [userId, roleId]
        );
      }
    }

    return res
      .status(201)
      .json({ message: "User created successfully", userId });
  } catch (err) {
    console.error("User creation error:", err);
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: err.message });
  }
});

/**
 * Login
 */
route.post("/login", loginLimiter, validateLogin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    const [rows] = await promiseConn.query(
      `SELECT 
        u.id,
        CONCAT(u.f_name, ' ', u.l_name) AS full_name,
        u.email,
        u.password_hash,
        u.status,
        u.organization AS organization_id,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', r.id,
            'title', r.title
          )
        ) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.roles_id = r.id
      WHERE u.email = ?
      GROUP BY u.id`,
      [email]
    );

    const genericError = {
      success: false,
      message: "Invalid email or password",
    };

    if (rows.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return res.status(404).json(genericError);
    }

    const user = rows[0];

    if (user.status === "suspended") {
      return res.status(401).json({
        message: "The user is suspended. Please contact the admin",
      });
    }

    const pass_match = await bcrypt.compare(password, user.password_hash);
    if (!pass_match) {
      return res.status(400).json(genericError);
    }
    console.log(user)
    let roles = [];
    try {
      if (!user.roles) {
        roles = [];
      } else if (typeof user.roles === "string") {
        roles = JSON.parse(user.roles);
      } else if (Array.isArray(user.roles)) {
        roles = user.roles;
      } else {
        roles = [];
      }
    } catch (e) {
      console.error("Error parsing roles:", e);
      roles = [];
    }

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        roles,
        userOrg: user.organization_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    const refreshToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        roles,
        userOrg: user.organization_id,
        type: "refresh",
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const hashedToken = await bcrypt.hash(refreshToken, 10);

    await promiseConn.query(
      "DELETE FROM user_refresh_tokens WHERE user_id = ?",
      [user.id]
    );

    await promiseConn.query(
      "INSERT INTO user_refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))",
      [user.id, hashedToken]
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const last_login = new Date();
    await promiseConn.query(`UPDATE users SET last_login_at = ? WHERE id = ?`, [
      last_login,
      user.id,
    ]);

    return res.status(200).json({
      success: true,
      message: "User logged in!",
      token: accessToken,

    });
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Refresh Token
 */
route.post("/refresh-token", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res
        .status(401)
        .json({ success: false, message: "Refresh token missing" });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (jwtError) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired refresh token" });
    }

    if (decoded.type !== "refresh") {
      return res
        .status(401)
        .json({ success: false, message: "Invalid token type" });
    }

    const [rows] = await promiseConn.query(
      "SELECT * FROM user_refresh_tokens WHERE user_id = ? AND expires_at > NOW()",
      [decoded.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Refresh token expired or not found",
      });
    }

    const tokenMatch = await bcrypt.compare(refreshToken, rows[0].token_hash);
    if (!tokenMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid refresh token" });
    }

    const [userRows] = await promiseConn.query(
      `SELECT 
        u.id,
        u.email,
        u.organization AS organization_id,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', r.id,
            'title', r.title,
            'description', r.description
          )
        ) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.roles_id = r.id
      WHERE u.id = ? AND u.status != 'suspended'
      GROUP BY u.id`,
      [decoded.userId]
    );

    if (userRows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "User not found or suspended" });
    }

    const user = userRows[0];
    let roles = [];
    try {
      if (!user.roles) {
        roles = [];
      } else if (typeof user.roles === "string") {
        roles = JSON.parse(user.roles);
      } else if (Array.isArray(user.roles)) {
        roles = user.roles;
      } else {
        roles = [];
      }
    } catch (e) {
      console.error("Error parsing roles:", e);
      roles = [];
    }

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        roles: roles,
        userOrg: user.organization_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.status(200).json({
      success: true,
      accessToken,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * Logout
 */
route.post("/logout", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      try {
        const decoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET
        );
        await promiseConn.query(
          "DELETE FROM user_refresh_tokens WHERE user_id = ?",
          [decoded.userId]
        );
      } catch (err) {
        console.log("Error decoding refresh token during logout:", err.message);
      }
    }

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    return res
      .status(200)
      .json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * Suspend User
 */
route.patch("/status/:id", authToken, async (req, res) => {
  const { id } = req.params;
  const status = "suspended";
  const updated_at = new Date();
  try {
    const suspendUser =
      "UPDATE users SET status = ?, updated_at = ? WHERE id = ?";
    const [result] = await promiseConn.query(suspendUser, [
      status,
      updated_at,
      id,
    ]);
    if (result.affectedRows === 0) {
      return res
        .status(400)
        .json({ message: "Unable to update user. Try again later!" });
    }
    return res.status(200).json({ message: "User suspended successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update user status" });
  }
});

/**
 * Update Team
 */
route.patch("/:id/team", authToken, async (req, res) => {
  const { id } = req.params;
  const { teams } = req.body;
  const updated_at = new Date();
  try {
    await promiseConn.query(
      "UPDATE users SET team = ?, updated_at = ? WHERE id = ?",
      [teams, updated_at, id]
    );
    return res.status(200).json({ message: "Team updated successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update teams" });
  }
});

/**
 * Get All Users
 */
route.get("/:orgId/all", authToken, async (req, res) => {
  const {orgId} = req.params;
  try {
    const getUsers = `
      SELECT 
        u.id,
        CONCAT(u.f_name, ' ', u.l_name) AS full_name,
        u.email,
        u.status,
        u.organization,
        u.created_at,
        JSON_ARRAYAGG(
          JSON_OBJECT('id', r.id, 'title', r.title)
        ) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.roles_id = r.id
      WHERE organization = ?
      GROUP BY u.id
    `;
    const [result] = await promiseConn.query(getUsers,[orgId]);
    if (result.length === 0) {
      return res.status(404).json({ error: "No users Available" });
    }
    return res.status(200).json({ result });
  } catch (e) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Get Specific User
 */
route.get("/:id", authToken, async (req, res) => {
  try {
    const { id } = req.params;
    const getUser = `
      SELECT 
        u.id,
        CONCAT(u.f_name, ' ', u.l_name) AS full_name,
        u.contact,
        u.email,
        u.status,
        u.last_login_at,
        u.created_at,
        u.updated_at,
        t.title AS team_title,
        o.name AS organization_name,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', r.id, 'title', r.title))
          FROM (
            SELECT DISTINCT r.id, r.title
            FROM user_roles ur
            JOIN roles r ON ur.roles_id = r.id
            WHERE ur.user_id = u.id
          ) r
        ), JSON_ARRAY()) AS roles,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', g.id, 'title', g.title, 'description', g.description))
          FROM (
            SELECT DISTINCT g.id, g.title, g.description
            FROM user_assigned_groups ug
            JOIN user_groups g ON ug.group_id = g.id
            WHERE ug.user_id = u.id
          ) g
        ), JSON_ARRAY()) AS \`groups\`
      FROM users u
      JOIN organizations o ON o.id = u.organization
      LEFT JOIN teams t ON t.id = u.team
      WHERE u.id = ?;
    `;

    const [result] = await promiseConn.query(getUser, [id]);

    if (result.length === 0) {
      return res.status(404).json({ error: "No users Available" });
    }

    return res.status(200).json({ result: result[0] });
  } catch (e) {
    console.error("Error fetching user:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = route;
