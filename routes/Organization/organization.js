const express = require('express')
const route = express.Router();
const mysqlconnect = require('../../db/conn')
const promiseConn = mysqlconnect().promise();
const { nanoid } = require('nanoid')
const authToken = require('../../Auth/tokenAuthentication')
const bcrypt = require("bcryptjs");


route.post('/register', async (req, res) => {
  const conn = promiseConn;
  const org_id = nanoid(7);
  const user_id = nanoid(5);
  const created_at = new Date();

  const {
    org_name,
    domain,
    city,
    country,
    primary_contact_name,
    primary_contact,
    f_name,
    l_name,
    email,
    password,
    contact
  } = req.body;
  if (!org_name || !domain || !country || !primary_contact_name || !f_name || !l_name || !email || !password) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const password_hash = bcrypt.hashSync(password, 10);

  try {
    await conn.beginTransaction();
    const insertOrg = `
      INSERT INTO organizations(id, name, domain, city, country, primary_contact_name, primary_contact, created_at) 
      VALUES(?,?,?,?,?,?,?,?)
    `;
    const [orgResult] = await conn.query(insertOrg, [
      org_id,
      org_name,
      domain,
      city || null,
      country,
      primary_contact_name,
      primary_contact || null,
      created_at
    ]);

    if (orgResult.affectedRows !== 1) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "Failed to create organization" });
    }
    const password_hash = bcrypt.hashSync(password, 10);
    const insertUser = `
      INSERT INTO users(id, f_name, l_name, email, password_hash, role, contact, organization, created_at) 
      VALUES(?,?,?,?,?,'admin',?,?,?)
    `;
    const [userResult] = await conn.query(insertUser, [
      user_id,
      f_name,
      l_name,
      email,
      password_hash,
      contact || null,
      org_id,
      created_at
    ]);

    if (userResult.affectedRows !== 1) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "Failed to create admin user" });
    }

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Organization and first admin user created successfully",
      organization: {
        id: org_id,
        name: org_name,
        domain,
        country,
        primary_contact_name
      },
      user: {
        id: user_id,
        f_name,
        l_name,
        email,
        role: "admin"
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error("Registration error:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
});



route.get('/all',authToken, async(req,res)=>{
    try{
        const getOrg = "SELECT * FROM organizations";
    const [result] = await promiseConn.query(getOrg);
    if(result.length === 0){
        return res.status(404).json({message:"There are no Organizations created at."});
    }
    return res.status(200).json({result:result})
    }
    catch(e){
        return res.status(500).json({message:"Internal Server Error", error:e})
    }
})

module.exports = route;