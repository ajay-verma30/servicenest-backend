const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const mysqlconnect = require('../db/conn');
const promiseConn = mysqlconnect().promise();
const sentOtp = require('../utils/mailer');
const jwt = require('jsonwebtoken');
const authenticateToken = require('../Auth/tokenAuthentication')


// Register new users
router.post('/new', async (req, res) => {
    try {
        const created_at = new Date();
        const { f_name, l_name, email, password, role } = req.body;

        if (!f_name || !l_name || !email || !password) {
            return res.status(400).json({ message: "All details are mandatory" });
        }

        const [existingUser] = await promiseConn.query("SELECT email FROM users WHERE email = ?", [email]);
        if (existingUser.length > 0) {
            return res.status(409).json({ message: "User with this email already exists. Try login or reset password." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const insertQuery = "INSERT INTO users (f_name, l_name, email, password, role, created_at) VALUES (?, ?, ?, ?, ?, ?)";
        const [result] = await promiseConn.query(insertQuery, [
            f_name,
            l_name,
            email,
            hashedPassword,
            role || 'user',
            created_at
        ]);

        if (result.affectedRows === 1) {
            return res.status(201).json({ message: "User created successfully" });
        }

        return res.status(500).json({ message: "Failed to create user. Try again later!" });
    } catch (e) {
        console.error("Error in /users/new:", e.message);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});



//Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    else{
            const [userSearch] = await promiseConn.query(
      "SELECT id, email, password, role FROM users WHERE email = ?",
      [email]
    );
    
    if (userSearch.length === 0) {
      return res.status(404).json({ message: "User not found. Confirm your email address." });
    }
    const usermatch = userSearch[0]
    const pass_match = await bcrypt.compare(password, usermatch.password);
    if(!pass_match){
        return res.status(401).json({message:":Invalid Credentials"})
    }
    const otp = Math.floor(100000 + Math.random() * 900000);
const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await promiseConn.query("INSERT INTO user_otps(user_id, otp, expires_at) VALUES(?,?,?)",[
        usermatch.id, otp, expires_at])
    await sentOtp(email, otp)
    return res.status(200).json({message: "OTP sent successfully"})
    }
  } catch (e) {
    console.error("Error in /users/login:", e.message);
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});

//OTP verification
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const [users] = await promiseConn.query("SELECT * FROM users WHERE email = ?", [email]);

    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = users[0];

    const [rows] = await promiseConn.query(
      "SELECT * FROM user_otps WHERE user_id = ? AND otp = ? AND verified = false AND expires_at > NOW()",
      [user.id, otp]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    await promiseConn.query("UPDATE user_otps SET verified = true WHERE id = ?", [rows[0].id]);

    await promiseConn.query("UPDATE users SET last_login = NOW() WHERE email = ?", [email]);

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '90m'
    });
    
    return res.status(200).json({ message: "OTP verified", token });
  } catch (e) {
    console.error("Verify OTP error:", e);
    return res.status(500).json({ message: "Internal Server Error",error:e});
  }
});


//get user details
router.get('/my-details', authenticateToken, async(req, res) => {
  try {
    const { email } = req.user;
    const [result] = await promiseConn.query("SELECT email, f_name, l_name, role, last_login, created_at FROM users WHERE email=?", [email])
    return res.status(200).json({userDetail: result})
  } catch (e) {
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});



module.exports = router;
