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

//Defining rate limiter
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

route.post("/new", async (req, res) => {
  try {
    const userId = nanoid(5);
    const created_at = new Date();
    const { f_name, l_name, email, password, role, contact, organization } = req.body;

    const password_hash = bcrypt.hashSync(password, 10);
    const insertQuery =
      "INSERT INTO users(id,f_name, l_name, email, password_hash, role, contact, created_at)VALUE(?,?,?,?,?,?,?,?)";
    const [result] = await promiseConn.query(insertQuery, [
      userId,
      f_name,
      l_name,
      email,
      password_hash,
      role,
      contact,
      created_at,
      organization
    ]);

    if (result.affectedRows !== 1) {
      return res
        .status(400)
        .json({ message: "Unable to create user. Please try again!" });
    }
    return res.status(201).json({ message: "User Created" });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: err });
  }
});

route.post("/login", loginLimiter, validateLogin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    const [rows] = await promiseConn.query(
      "SELECT * FROM users WHERE email = ?",
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
      return res
        .status(401)
        .json({ message: "The user is suspended. Please contact the admin" });
    }

    const pass_match = await bcrypt.compare(password, user.password_hash);
    if (!pass_match) {
      return res.status(400).json(genericError);
    }

    // Access Token
    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        userOrg: user.organization,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    // Refresh token
    const refreshToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        userOrg: user.organization,
        type: "refresh",
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const hashedToken = await bcrypt.hash(refreshToken, 10);
    await promiseConn.query(
      `INSERT INTO user_refresh_tokens (user_id, token_hash, expires_at) 
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
             ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at)`,
      [user.id, hashedToken]
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const last_login = new Date();
    await promiseConn.query(`UPDATE users SET last_login_at = ? WHERE id = ?`, [
      last_login,
      user.id,
    ]);

    return res.status(200).json({
      message: "User logged in!",
      token: accessToken,
    });
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

route.post("/refresh-token", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res
        .status(401)
        .json({ success: false, message: "Refresh token missing" });
    }
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
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
      return res
        .status(401)
        .json({
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
      'SELECT id, email, role, organization FROM users WHERE id = ? AND status != "suspended"',
      [decoded.userId]
    );

    if (userRows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "User not found or suspended" });
    }
    const user = userRows[0];
    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        userOrg: user.organization,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.status(200).json({
      success: true,
      accessToken: accessToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);

    if (error.name === "JsonWebTokenError") {
      return res
        .status(401)
        .json({ success: false, message: "Invalid refresh token format" });
    }
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ success: false, message: "Refresh token expired" });
    }

    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

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

route.get("/all", authToken, async(req, res) => {
  try {
    const getUsers = "SELECT * FROM users";
    const [result] = await promiseConn.query(getUsers);
    if (result.length === 0) {
      return res.status(404).json({ error: "No users Available" });
    }
    return res.status(200).json({ result: result });
  } catch (e) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

route.get("/:id", authToken, async (req, res) => {
  try {
    const { id } = req.params;
    const getUser = `
      SELECT 
        CONCAT(u.f_name, ' ', u.l_name) AS full_name,
        u.contact,
        u.email,
        u.role,
        u.status,
        u.last_login_at,
        u.created_at,
        u.updated_at,
        t.title AS team_title,
        o.name AS organization_name
      FROM users u
      JOIN teams t ON t.id = u.team
      JOIN organizations o ON o.id = u.organization
      WHERE u.id = ?
    `;
    const [result] = await promiseConn.query(getUser, [id]);
    if (result.length === 0) {
      return res.status(404).json({ error: "No users Available" });
    }
    return res.status(200).json({ result });
  } catch (e) {
    console.error("Error fetching user by ID:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


route.get('/user/:id', authToken, async (req, res) => {
  try {
    const { id } = req.params;

    const getSpectUser =
      `SELECT CONCAT(u.f_name, ' ', u.l_name) AS full_name,
       u.contact,
       u.email,
       u.role,
       u.status,
       u.last_login_at,
       u.created_at,
       u.updated_at,
       t.title AS team_title
       FROM users u 
       JOIN organizations o ON o.id = u.organization
       LEFT JOIN teams t ON u.team = t.id
       WHERE u.id = ?`;

    const [result] = await promiseConn.query(getSpectUser, [id]);

    if (result.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(result[0]);
  } catch (e) {
    console.error("Error fetching user by ID:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = route;
